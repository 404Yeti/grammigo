import { CEFR_LEVELS, type CefrLevel, type CurriculumSkill } from "@/curriculum/schema";
import { DEFAULT_MASTERY_CONFIG, type MasteryConfig, type SkillMastery } from "./mastery";
import { bucketFor } from "./profile";

export type RecommendationKind = "remediation" | "weak" | "goal" | "review" | "continue" | "new";

export interface Recommendation {
  skillId: string;
  kind: RecommendationKind;
  /** Higher is recommended first. Scores are internal ordering values, not probabilities. */
  score: number;
  /** Plain-language reason shown to the learner. */
  reason: string;
  /** For remediation: the lesson that needed this prerequisite first. */
  forSkillId?: string;
}

export type Readiness = "ready" | "unknown" | "not_ready";

export interface PrerequisiteReadiness {
  state: Readiness;
  /** Direct prerequisites with assessed weak evidence. */
  weak: string[];
  /** Direct prerequisites with no evidence yet. */
  unknown: string[];
}

const DAY = 24 * 60 * 60 * 1000;
const levelIdx = (l: CefrLevel) => CEFR_LEVELS.indexOf(l);

/**
 * A prerequisite is "not ready" only on evidence of weakness (a poor score). Missing evidence
 * is "unknown": it never blocks a lesson, because absence of evidence is not failure.
 */
export function prerequisiteReadiness(
  skill: CurriculumSkill,
  mastery: ReadonlyMap<string, SkillMastery>,
  config: MasteryConfig = DEFAULT_MASTERY_CONFIG,
): PrerequisiteReadiness {
  const weak: string[] = [];
  const unknown: string[] = [];
  for (const pre of skill.prerequisites) {
    const m = mastery.get(pre);
    if (!m || m.score === null) unknown.push(pre);
    else if (m.score < config.prerequisiteReadyScore) weak.push(pre);
  }
  return { state: weak.length > 0 ? "not_ready" : unknown.length > 0 ? "unknown" : "ready", weak, unknown };
}

export interface RecommendInput {
  skills: readonly CurriculumSkill[];
  mastery: ReadonlyMap<string, SkillMastery>;
  goalSkillIds: readonly string[];
  now: number;
  config?: MasteryConfig;
}

/**
 * Deterministic, explainable lesson ranking. Priority, high to low:
 *   remediation of a weak prerequisite > weak skills > stated goals > due reviews >
 *   in-progress skills > new skills near the learner's frontier.
 * Levels are never gates: a learner with B2 strengths and an A2 gap is sent to the A2 gap first.
 * Ties break by catalog order, so the same inputs always give the same answer.
 */
export function recommendLessons(input: RecommendInput): Recommendation[] {
  const { skills, mastery, now } = input;
  const config = input.config ?? DEFAULT_MASTERY_CONFIG;
  const goals = new Set(input.goalSkillIds);
  const byId = new Map(skills.map((s) => [s.id, s]));
  const order = new Map(skills.map((s, i) => [s.id, i]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const get = (id: string) => mastery.get(id)!;

  const strengthIdx = skills
    .filter((s) => bucketFor(get(s.id), config) === "strength")
    .map((s) => levelIdx(s.cefr));
  const frontier = strengthIdx.length > 0 ? Math.max(...strengthIdx) : 0;
  const anyEvidence = skills.some((s) => get(s.id).score !== null);

  const best = new Map<string, Recommendation>();
  const offer = (rec: Recommendation) => {
    const current = best.get(rec.skillId);
    if (!current || rec.score > current.score) best.set(rec.skillId, rec);
  };

  /** The lowest weak prerequisite underneath a skill (follows the chain down). */
  const rootWeakPrerequisite = (skill: CurriculumSkill, seen = new Set<string>()): string | null => {
    if (seen.has(skill.id)) return null;
    seen.add(skill.id);
    const { weak } = prerequisiteReadiness(skill, mastery, config);
    for (const id of [...weak].sort((a, b) => levelIdx(byId.get(a)!.cefr) - levelIdx(byId.get(b)!.cefr))) {
      const deeper = rootWeakPrerequisite(byId.get(id)!, seen);
      return deeper ?? id;
    }
    return null;
  };

  for (const skill of skills) {
    const m = get(skill.id);
    const readiness = prerequisiteReadiness(skill, mastery, config);
    const isGoal = goals.has(skill.id);

    if (readiness.state === "not_ready") {
      const rootId = rootWeakPrerequisite(skill);
      if (rootId) {
        const rm = get(rootId);
        offer({
          skillId: rootId,
          kind: "remediation",
          forSkillId: skill.id,
          score: 105 + (1 - (rm.score ?? 0)) * 30 + (isGoal ? 10 : 0) + (m.status === "needs_practice" ? 5 : 0),
          reason: `Before “${skill.title}”, it helps to firm up “${title(rootId)}”. You had trouble with it, and it builds the foundation for the next step.`,
        });
      }
      continue;
    }

    const unknownNote = readiness.state === "unknown" ? 5 : 0;

    if (m.status === "needs_practice") {
      const missed = m.incorrect;
      offer({
        skillId: skill.id,
        kind: "weak",
        score: 100 + (1 - (m.score ?? 0)) * 30 + m.recurringErrors.length * 5 + (isGoal ? 15 : 0),
        reason:
          m.recurringErrors.length > 0
            ? `You’ve missed or needed help with some of the same questions in “${skill.title}” more than once, so a focused practice is the best next step.`
            : `“${skill.title}” was tough this time (${m.independent} on your own, ${m.assisted} with help, ${missed} missed). More practice here will help most.`,
      });
      continue;
    }

    if (isGoal && m.status !== "strong") {
      offer({
        skillId: skill.id,
        kind: "goal",
        score: 90 - unknownNote,
        reason: `You told Migo you want to improve this area (“${skill.title}”), and you haven’t built up much evidence on it yet.`,
      });
      continue;
    }

    if (m.reviewDue && (m.status === "strong" || m.status === "developing")) {
      const overdue = Math.min(10, Math.max(0, ((now - (m.reviewDueAt ?? now)) / DAY)));
      const daysAgo = Math.round(((now - (m.lastEventAt ?? now)) / DAY));
      offer({
        skillId: skill.id,
        kind: "review",
        score: 70 + overdue,
        reason: `Time for a review: you last practiced “${skill.title}” ${daysAgo <= 0 ? "today" : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`}, and spaced practice helps it stick.`,
      });
      continue;
    }

    if (m.status === "learning" || m.status === "developing") {
      offer({
        skillId: skill.id,
        kind: "continue",
        score: 55 + (1 - (m.score ?? 0)) * 10,
        reason: `You’re making progress on “${skill.title}”. A bit more practice will show how solid it really is.`,
      });
      continue;
    }

    if (m.status === "not_assessed") {
      const gap = levelIdx(skill.cefr) - frontier;
      const fit = gap <= 1 ? 10 : -10 * (gap - 1);
      offer({
        skillId: skill.id,
        kind: "new",
        score: 50 + fit - unknownNote - levelIdx(skill.cefr) * 0.5,
        reason: anyEvidence
          ? `“${skill.title}” is a new area (${skill.cefr}) close to what you already do well.`
          : `We don’t have any evidence about your grammar yet, so we’ll start with a friendly foundation: “${skill.title}”.`,
      });
    }
    // strong and not due: nothing to recommend for this skill
  }

  const ranked = [...best.values()].sort(
    (a, b) => b.score - a.score || (order.get(a.skillId) ?? 0) - (order.get(b.skillId) ?? 0),
  );
  if (ranked.length > 0) return ranked;

  // Everything is strong and not yet due: suggest whichever review comes up soonest.
  const soonest = skills
    .map((s) => ({ s, m: get(s.id) }))
    .filter(({ m }) => m.reviewDueAt !== null)
    .sort((a, b) => (a.m.reviewDueAt ?? 0) - (b.m.reviewDueAt ?? 0))[0];
  return soonest
    ? [
        {
          skillId: soonest.s.id,
          kind: "review",
          score: 10,
          reason: `You’re doing well everywhere we’ve checked. A light review of “${soonest.s.title}” keeps it fresh.`,
        },
      ]
    : [];
}

export interface RecommendationSnapshot {
  skillId: string;
  kind: RecommendationKind;
  at: number;
}

/**
 * Explains, in plain words, why the recommendation is what it is, and what changed since last time.
 * `lastLesson` is the lesson the learner just finished (if any).
 */
export function explainRecommendationChange(input: {
  previous: RecommendationSnapshot | null;
  next: Recommendation;
  titleOf: (skillId: string) => string;
  lastLesson?: { skillId: string; independent: number; assisted: number; incorrect: number; total: number } | null;
}): string {
  const { previous, next, titleOf, lastLesson } = input;
  if (!previous) return next.reason;

  const same = previous.skillId === next.skillId && previous.kind === next.kind;
  const finished = lastLesson
    ? `You finished “${titleOf(lastLesson.skillId)}” with ${lastLesson.independent} of ${lastLesson.total} answers on your own${lastLesson.assisted + lastLesson.incorrect > 0 ? ` and ${lastLesson.assisted + lastLesson.incorrect} that needed help or were missed` : ""}. `
    : "";

  if (same) return `${finished}We’re still suggesting “${titleOf(next.skillId)}”. ${next.reason}`;
  if (previous.skillId === next.skillId) {
    return `${finished}We’re still suggesting “${titleOf(next.skillId)}”, but for a different reason now. ${next.reason}`;
  }
  return `${finished}Last time we suggested “${titleOf(previous.skillId)}”; now we suggest “${titleOf(next.skillId)}” instead. ${next.reason}`;
}
