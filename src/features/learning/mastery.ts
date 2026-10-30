import type { Classification } from "@/types/session";

/**
 * Evidence-based skill mastery estimates. Pure and deterministic.
 *
 * IMPORTANT: every threshold below is an initial engineering heuristic. None of them has been
 * validated against learner data, and they must not be presented as scientifically established.
 * They are collected here so they can be inspected, tuned and unit-tested in one place.
 */
export interface MasteryConfig {
  /** How much each attempt classification counts toward a skill estimate (0–1). */
  outcomeValue: Record<Classification, number>;
  /** Diagnostic answers are a single short item, so they count for less than a lesson answer. */
  sourceWeight: { lesson: number; diagnostic: number };
  /** Older evidence counts for less: weight halves every this many days. */
  recencyHalfLifeDays: number;
  /** Evidence quantity (sum of source weights, undecayed) at which confidence rises. */
  confidenceAt: { low: number; medium: number; high: number };
  needsPracticeBelow: number;
  developingFrom: number;
  strongFrom: number;
  /** "Strong" needs at least this much evidence spread over at least this many sittings. */
  strongMinWeight: number;
  strongMinGroups: number;
  /** A prerequisite counts as ready at or above this score. */
  prerequisiteReadyScore: number;
  /** This many repeated mistakes (same question, different sittings) flags "needs practice" while the score is below developingFrom. */
  recurringErrorsNeedPractice: number;
  /** Score at or above which a thin-evidence skill is shown as a (provisional) strength. */
  likelyStrengthAt: number;
  review: {
    /** Days until review is due, by consecutive successful sittings. */
    intervalsDays: number[];
    /** A sitting scoring at or above this counts as successful for spacing. */
    goodSittingScore: number;
  };
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  outcomeValue: { correct_first_try: 1, correct_after_hint: 0.5, correct_after_retry: 0.4, incorrect: 0 },
  sourceWeight: { lesson: 1, diagnostic: 0.5 },
  recencyHalfLifeDays: 30,
  confidenceAt: { low: 2, medium: 6, high: 12 },
  needsPracticeBelow: 0.5,
  developingFrom: 0.6,
  strongFrom: 0.8,
  strongMinWeight: 12,
  strongMinGroups: 2,
  prerequisiteReadyScore: 0.6,
  recurringErrorsNeedPractice: 2,
  likelyStrengthAt: 0.75,
  review: { intervalsDays: [1, 3, 7, 14, 30], goodSittingScore: 0.7 },
};

export type EvidenceSource = "lesson" | "diagnostic";

/** One observed answer for one skill. Skipped questions are never evidence. */
export interface EvidenceEvent {
  skillId: string;
  outcome: Classification;
  source: EvidenceSource;
  /** Lesson session id or diagnostic run id: answers from one sitting share a group. */
  groupId: string;
  /** "skillId/questionId": identifies the same question across attempts. */
  questionKey: string;
  at: number;
}

export type MasteryStatus = "not_assessed" | "learning" | "needs_practice" | "developing" | "strong";
export type Confidence = "none" | "insufficient" | "low" | "medium" | "high";

export interface SkillMastery {
  skillId: string;
  status: MasteryStatus;
  /** Recency- and source-weighted score in 0–1, or null with no evidence. */
  score: number | null;
  /** Total evidence quantity (undecayed, source-weighted). */
  evidenceWeight: number;
  confidence: Confidence;
  /** True while evidence is thin: the status is an early read, not a conclusion. */
  provisional: boolean;
  independent: number;
  assisted: number;
  incorrect: number;
  groups: number;
  lastEventAt: number | null;
  /** Question keys answered wrongly or only with help in two or more different sittings. */
  recurringErrors: string[];
  reviewDueAt: number | null;
  reviewDue: boolean;
  /** Plain-language reasons behind the status, for transparency in the UI. */
  reasons: string[];
}

const DAY = 24 * 60 * 60 * 1000;

function confidenceFor(weight: number, c: MasteryConfig): Confidence {
  if (weight <= 0) return "none";
  if (weight < c.confidenceAt.low) return "insufficient";
  if (weight < c.confidenceAt.medium) return "low";
  if (weight < c.confidenceAt.high) return "medium";
  return "high";
}

export function emptyMastery(skillId: string): SkillMastery {
  return {
    skillId,
    status: "not_assessed",
    score: null,
    evidenceWeight: 0,
    confidence: "none",
    provisional: true,
    independent: 0,
    assisted: 0,
    incorrect: 0,
    groups: 0,
    lastEventAt: null,
    recurringErrors: [],
    reviewDueAt: null,
    reviewDue: false,
    reasons: ["No evidence yet."],
  };
}

/** Mean outcome value of the events in one sitting (unweighted). */
function sittingScore(events: EvidenceEvent[], c: MasteryConfig): number {
  return events.reduce((sum, e) => sum + c.outcomeValue[e.outcome], 0) / events.length;
}

export function computeSkillMastery(
  skillId: string,
  allEvents: readonly EvidenceEvent[],
  now: number,
  config: MasteryConfig = DEFAULT_MASTERY_CONFIG,
): SkillMastery {
  const events = allEvents.filter((e) => e.skillId === skillId).sort((a, b) => a.at - b.at);
  if (events.length === 0) return emptyMastery(skillId);

  let weighted = 0;
  let totalWeight = 0;
  let evidenceWeight = 0;
  let independent = 0;
  let assisted = 0;
  let incorrect = 0;

  for (const e of events) {
    const ageDays = Math.max(0, (now - e.at) / DAY);
    const recency = Math.pow(0.5, ageDays / config.recencyHalfLifeDays);
    const w = config.sourceWeight[e.source] * recency;
    weighted += w * config.outcomeValue[e.outcome];
    totalWeight += w;
    evidenceWeight += config.sourceWeight[e.source];
    if (e.outcome === "correct_first_try") independent += 1;
    else if (e.outcome === "incorrect") incorrect += 1;
    else assisted += 1;
  }
  const score = totalWeight > 0 ? weighted / totalWeight : 0;

  // Group by sitting, in time order.
  const byGroup = new Map<string, EvidenceEvent[]>();
  for (const e of events) byGroup.set(e.groupId, [...(byGroup.get(e.groupId) ?? []), e]);
  const groups = [...byGroup.values()].sort((a, b) => a[a.length - 1].at - b[b.length - 1].at);

  // Recurring errors: same question missed or only passed with help in 2+ sittings.
  const errorGroups = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.outcome === "correct_first_try") continue;
    errorGroups.set(e.questionKey, (errorGroups.get(e.questionKey) ?? new Set()).add(e.groupId));
  }
  const recurringErrors = [...errorGroups.entries()].filter(([, g]) => g.size >= 2).map(([k]) => k);

  const confidence = confidenceFor(evidenceWeight, config);
  const reasons: string[] = [];
  let status: MasteryStatus;

  const repeatedlyMissed =
    recurringErrors.length >= config.recurringErrorsNeedPractice && score < config.developingFrom;
  if (score < config.needsPracticeBelow || repeatedlyMissed) {
    status = "needs_practice";
    reasons.push(`Answers were often missed or needed help (${independent} independent, ${assisted} with help, ${incorrect} missed).`);
  } else if (
    evidenceWeight >= config.strongMinWeight &&
    groups.length >= config.strongMinGroups &&
    score >= config.strongFrom &&
    recurringErrors.length === 0
  ) {
    status = "strong";
    reasons.push(`Mostly independent across ${groups.length} sittings, with no repeated mistakes.`);
  } else if (score >= config.developingFrom && confidence !== "insufficient") {
    status = "developing";
    reasons.push("Going well, but not yet enough evidence across enough sittings to call it strong.");
  } else {
    status = "learning";
    reasons.push("Some evidence so far, not yet enough to judge.");
  }

  if (confidence === "insufficient" || confidence === "low") {
    reasons.push("Based on a small amount of evidence, so this is an early read.");
  }
  if (recurringErrors.length > 0) reasons.push(`${recurringErrors.length} repeated mistake${recurringErrors.length === 1 ? "" : "s"} across sittings.`);

  // Spaced review: consecutive good sittings lengthen the interval; a weak sitting resets it.
  let level = -1;
  for (const g of groups) {
    level = sittingScore(g, config) >= config.review.goodSittingScore
      ? Math.min(level + 1, config.review.intervalsDays.length - 1)
      : 0;
  }
  const last = groups[groups.length - 1];
  const lastAt = last[last.length - 1].at;
  const reviewDueAt = lastAt + config.review.intervalsDays[Math.max(level, 0)] * DAY;

  return {
    skillId,
    status,
    score,
    evidenceWeight,
    confidence,
    provisional: confidence === "insufficient" || confidence === "low",
    independent,
    assisted,
    incorrect,
    groups: groups.length,
    lastEventAt: lastAt,
    recurringErrors,
    reviewDueAt,
    reviewDue: now >= reviewDueAt,
    reasons,
  };
}

export function computeAllMastery(
  skillIds: readonly string[],
  events: readonly EvidenceEvent[],
  now: number,
  config: MasteryConfig = DEFAULT_MASTERY_CONFIG,
): Map<string, SkillMastery> {
  return new Map(skillIds.map((id) => [id, computeSkillMastery(id, events, now, config)]));
}
