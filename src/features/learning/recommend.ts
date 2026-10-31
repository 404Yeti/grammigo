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
  /** Direct prerequisites that look weak but rest on too little evidence to act on (only with `reliableOnly`). */
  tentative: string[];
}

export interface ReadinessOptions {
  /**
   * Treat a low score as a weak prerequisite only when there is enough evidence behind it
   * (confidence above "insufficient"). Otherwise it is reported as `tentative` and does not block.
   */
  reliableOnly?: boolean;
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
  options: ReadinessOptions = {},
): PrerequisiteReadiness {
  const weak: string[] = [];
  const unknown: string[] = [];
  const tentative: string[] = [];
  for (const pre of skill.prerequisites) {
    const m = mastery.get(pre);
    if (!m || m.score === null) unknown.push(pre);
    else if (m.score < config.prerequisiteReadyScore) {
      if (options.reliableOnly && (m.confidence === "none" || m.confidence === "insufficient")) tentative.push(pre);
      else weak.push(pre);
    }
  }
  const state = weak.length > 0 ? "not_ready" : unknown.length > 0 || tentative.length > 0 ? "unknown" : "ready";
  return { state, weak, unknown, tentative };
}

export interface RecommendInput {
  skills: readonly CurriculumSkill[];
  mastery: ReadonlyMap<string, SkillMastery>;
  goalSkillIds: readonly string[];
  now: number;
  config?: MasteryConfig;
}

/**
 * Deterministic, explainable lesson ranking.
 *
 * Without stated goals, priority is, high to low: remediation of a weak prerequisite > weak skills >
 * due reviews > in-progress skills > new skills near the learner's frontier. Levels are never gates:
 * a learner with B2 strengths and an A2 gap is sent to the A2 gap first.
 *
 * With stated goals that are still being established (not yet "developing"), the learner's goals set
 * the direction (in the order they were stated):
 *   - lessons that serve a goal (the goal itself, or a genuinely weak prerequisite in that goal's own
 *     dependency chain) always outrank lessons that do not;
 *   - prerequisite remediation is only ever created ahead of a goal, never for unrelated lessons;
 *   - a prerequisite counts as weak only when the evidence is reliable (confidence above
 *     "insufficient"); a single early-read miss never blocks a goal. It is kept as ordinary supporting
 *     practice after the goal instead.
 * Mastery evidence is never changed here: this only decides the order and the explanation.
 * Ties break by catalog order, so the same inputs always give the same answer.
 */
export function recommendLessons(input: RecommendInput): Recommendation[] {
  const { skills, mastery, now } = input;
  const config = input.config ?? DEFAULT_MASTERY_CONFIG;
  const byId = new Map(skills.map((s) => [s.id, s]));
  // Stated order is kept (first stated = highest priority); unknown ids and repeats are dropped.
  const stated = [...new Set(input.goalSkillIds)].filter((id) => byId.has(id));
  // A goal sets the direction only while it is still being established: no evidence yet, thin
  // evidence, or struggling. Once it is "developing" (adequate evidence, going well) or "strong" it has
  // had its turn, so it must not keep winning over everything else (that would loop the learner through
  // the same lesson). With no goal left to establish, ranking is exactly the no-goals behaviour.
  const establishing = stated.filter((id) => {
    const status = mastery.get(id)?.status ?? "not_assessed";
    return status === "not_assessed" || status === "learning" || status === "needs_practice";
  });
  const hasGoals = establishing.length > 0;
  const goalList = hasGoals ? establishing : stated;
  const goals = new Set(goalList);
  const readinessOptions: ReadinessOptions = { reliableOnly: hasGoals };
  /** Added to anything that serves a goal: it outranks everything that does not, and earlier goals outrank later ones. */
  const goalBonus = (goalId: string) => (hasGoals ? 1000 + (goalList.length - goalList.indexOf(goalId)) * 200 : 0);
  const order = new Map(skills.map((s, i) => [s.id, i]));
  const quoted = (ids: string[]) => ids.map((id) => `“${byId.get(id)?.title ?? id}”`).join(" and ");
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
    const { weak } = prerequisiteReadiness(skill, mastery, config, readinessOptions);
    for (const id of [...weak].sort((a, b) => levelIdx(byId.get(a)!.cefr) - levelIdx(byId.get(b)!.cefr))) {
      const deeper = rootWeakPrerequisite(byId.get(id)!, seen);
      return deeper ?? id;
    }
    return null;
  };

  for (const skill of skills) {
    const m = get(skill.id);
    const readiness = prerequisiteReadiness(skill, mastery, config, readinessOptions);
    const isGoal = goals.has(skill.id);

    if (readiness.state === "not_ready") {
      // With goals, remediation exists only to unblock a goal that is not yet mastered.
      if (hasGoals && (!isGoal || m.status === "strong")) continue;
      const rootId = rootWeakPrerequisite(skill);
      if (rootId) {
        const rm = get(rootId);
        const attempts = rm.independent + rm.assisted + rm.incorrect;
        const trouble = rm.incorrect + rm.assisted;
        offer({
          skillId: rootId,
          kind: "remediation",
          forSkillId: skill.id,
          score:
            105 + (1 - (rm.score ?? 0)) * 30 + (isGoal ? 10 : 0) + (m.status === "needs_practice" ? 5 : 0) + (isGoal ? goalBonus(skill.id) : 0),
          reason: hasGoals
            ? `You want to work on “${skill.title}”. “${title(rootId)}” is one of its building blocks, and ${trouble} of ${attempts} answer${attempts === 1 ? "" : "s"} on it ${trouble === 1 ? "was" : "were"} missed or needed help. A short practice there first will make “${skill.title}” easier, and then we go straight to it.`
            : `Before “${skill.title}”, it helps to firm up “${title(rootId)}”. You had trouble with it, and it builds the foundation for the next step.`,
        });
      }
      continue;
    }

    const unknownNote = readiness.state === "unknown" ? 5 : 0;

    if (m.status === "needs_practice") {
      const missed = m.incorrect;
      const repeated = m.recurringErrors.length > 0;
      const reason = isGoal
        ? repeated
          ? `You asked to work on “${skill.title}”, and you’ve missed or needed help with some of the same questions more than once, so a focused practice is the best next step.`
          : `You asked to work on “${skill.title}”, and it was tough this time (${m.independent} on your own, ${m.assisted} with help, ${missed} missed). More practice here will help most.`
        : repeated
          ? `You’ve missed or needed help with some of the same questions in “${skill.title}” more than once, so a focused practice is the best next step.`
          : `“${skill.title}” was tough this time (${m.independent} on your own, ${m.assisted} with help, ${missed} missed). More practice here will help most.`;
      offer({
        skillId: skill.id,
        kind: "weak",
        score: 100 + (1 - (m.score ?? 0)) * 30 + m.recurringErrors.length * 5 + (isGoal ? 15 + goalBonus(skill.id) : 0),
        reason,
      });
      continue;
    }

    if (isGoal && m.status !== "strong") {
      const early = readiness.tentative;
      offer({
        skillId: skill.id,
        kind: "goal",
        score: 90 - unknownNote + goalBonus(skill.id),
        reason:
          `You told Migo you want to improve this area (“${skill.title}”), and you haven’t built up much evidence on it yet.` +
          (early.length > 0
            ? ` The quick check hinted that ${quoted(early)} might need a refresher, but that rests on very little evidence, so you can start right here. We’ll suggest ${early.length === 1 ? "it" : "them"} next if ${early.length === 1 ? "it keeps" : "they keep"} coming up.`
            : ""),
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
