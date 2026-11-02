import type { OptionalSpeaking } from "./speaking-schema";
import { CEFR_LEVELS, DIAGNOSTIC_TYPES, type CefrLevel, type CurriculumSkill } from "@/curriculum/schema";
import { evaluateAnswer } from "@/features/practice/grading";
import type { EvidenceEvent } from "@/features/learning/mastery";
import type { Question } from "@/types/lesson";

/**
 * Adaptive diagnostic: a short, deterministic quiz over curated closed-ended items.
 *
 * - Items are existing validated lesson questions with known answers. Nothing here is generated
 *   or graded by AI, and nothing is random: the same responses always lead to the same next item.
 * - Selection is a transparent score (goals, closeness to the current ability estimate,
 *   prerequisite probing, level coverage, topic variety). Tie-breaks follow catalog order.
 * - The ability estimate is a simple up/down staircase, used only to choose questions. It is not
 *   reported to the learner and is not a CEFR level.
 *
 * All numbers are initial heuristics, not validated.
 */
export const DIAGNOSTIC_CONFIG = {
  minQuestions: 5,
  targetQuestions: 8,
  maxQuestions: 10,
  extensionQuestions: 4,
  /** Concept repetition guard: one item per skill (a second only replaces a skipped one). */
  maxPerSkill: 1,
  maxSkipRun: 3,
  minAnsweredForConclusive: 6,
  skipRateInconclusive: 0.4,
  startLevel: 2,
  weights: { goal: 40, goalTopic: 10, proximity: 24, proximityPerLevel: 8, probeCorrect: 20, probeIncorrect: 35, coverage: 10, sameTopic: -15, repeatedTopic: -30 },
} as const;

export interface DiagnosticItem {
  /** "skillId/questionId" — matches lesson evidence keys. */
  id: string;
  skillId: string;
  questionId: string;
  cefr: CefrLevel;
  /** 1 (A1) … 6 (C2). */
  level: number;
  topic: string;
  difficulty: 1 | 2 | 3;
  question: Question;
}

export type ItemOutcome = "correct" | "incorrect" | "skipped";

export interface DiagnosticResponse {
  itemId: string;
  skillId: string;
  outcome: ItemOutcome;
  at: number;
}

export interface DiagnosticRun {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  /** Skill ids inferred from the learner's own words. May be empty (general check). */
  goalSkillIds: string[];
  responses: DiagnosticResponse[];
  /** The learner chose to answer a few more questions for a clearer picture. */
  extended: boolean;
  /** Optional confirmed sample, kept out of adaptive selection and evidence. */
  optionalSpeaking?: OptionalSpeaking;
}

export const levelNumber = (cefr: CefrLevel) => CEFR_LEVELS.indexOf(cefr) + 1;

const TYPE_PREFERENCE = ["multiple-choice", "multiple-choice-context", "contextual-verb", "fill-blank"];

export function buildItemPool(skills: readonly CurriculumSkill[]): DiagnosticItem[] {
  return skills.flatMap((skill) =>
    skill.questions
      .filter((q) => (DIAGNOSTIC_TYPES as readonly string[]).includes(q.type))
      .map((q) => ({
        id: `${skill.id}/${q.id}`,
        skillId: skill.id,
        questionId: q.id,
        cefr: skill.cefr,
        level: levelNumber(skill.cefr),
        topic: skill.topic,
        difficulty: q.difficulty,
        question: q,
      })),
  );
}

export function createRun(id: string, goalSkillIds: readonly string[], now: number): DiagnosticRun {
  return { id, startedAt: now, finishedAt: null, goalSkillIds: [...goalSkillIds], responses: [], extended: false };
}

/** Up/down staircase over answered items, used only to pick the next question. */
export function estimateLevel(run: DiagnosticRun, levelOfSkill: (skillId: string) => number): number {
  let level: number = DIAGNOSTIC_CONFIG.startLevel;
  for (const r of run.responses) {
    if (r.outcome === "skipped") continue;
    const l = levelOfSkill(r.skillId);
    level = r.outcome === "correct" ? Math.min(6, Math.max(level, l) + 0.5) : Math.max(0.5, Math.min(level, l) - 0.75);
  }
  return level;
}

export interface Inconclusive {
  inconclusive: boolean;
  reasons: string[];
}

export function assessInconclusive(run: DiagnosticRun): Inconclusive {
  const asked = run.responses.length;
  const answered = run.responses.filter((r) => r.outcome !== "skipped");
  const reasons: string[] = [];
  if (asked > 0 && answered.length < DIAGNOSTIC_CONFIG.minAnsweredForConclusive) {
    reasons.push("Only a few questions were answered.");
  }
  if (asked > 0 && (asked - answered.length) / asked >= DIAGNOSTIC_CONFIG.skipRateInconclusive) {
    reasons.push("Many questions were skipped.");
  }
  const uncovered = run.goalSkillIds.filter((g) => !answered.some((r) => r.skillId === g));
  if (uncovered.length > 0) reasons.push("Some areas you mentioned haven’t been checked yet.");
  return { inconclusive: reasons.length > 0, reasons };
}

export type StopReason = "limit" | "disengaged" | "clear-floor" | "conclusive";

export function stopStatus(run: DiagnosticRun): { done: boolean; reason?: StopReason } {
  const c = DIAGNOSTIC_CONFIG;
  const asked = run.responses.length;
  const limit = c.maxQuestions + (run.extended ? c.extensionQuestions : 0);
  if (asked >= limit) return { done: true, reason: "limit" };

  let skipRun = 0;
  for (let i = run.responses.length - 1; i >= 0 && run.responses[i].outcome === "skipped"; i--) skipRun++;
  if (skipRun >= c.maxSkipRun) return { done: true, reason: "disengaged" };

  if (asked < c.minQuestions) return { done: false };

  const answered = run.responses.filter((r) => r.outcome !== "skipped");
  if (answered.length >= c.minQuestions && answered.every((r) => r.outcome === "incorrect")) {
    return { done: true, reason: "clear-floor" };
  }
  if (asked >= c.targetQuestions && !assessInconclusive(run).inconclusive) {
    return { done: true, reason: "conclusive" };
  }
  return { done: false };
}

/** After the base limit, an inconclusive run may offer a few extra questions. */
export function canExtend(run: DiagnosticRun): boolean {
  return (
    !run.extended &&
    run.responses.length >= DIAGNOSTIC_CONFIG.maxQuestions &&
    assessInconclusive(run).inconclusive &&
    stopStatus(run).reason === "limit"
  );
}

export function extendRun(run: DiagnosticRun): DiagnosticRun {
  return { ...run, extended: true, finishedAt: null };
}

/**
 * Picks the next item, or null when the run is finished. Deterministic.
 */
export function selectNextItem(
  run: DiagnosticRun,
  pool: readonly DiagnosticItem[],
  skills: readonly CurriculumSkill[],
): DiagnosticItem | null {
  if (stopStatus(run).done) return null;
  const w = DIAGNOSTIC_CONFIG.weights;
  const byId = new Map(skills.map((s) => [s.id, s]));
  const order = new Map(skills.map((s, i) => [s.id, i]));
  const levelOf = (id: string) => levelNumber(byId.get(id)!.cefr);
  const askedItems = new Set(run.responses.map((r) => r.itemId));
  const L = estimateLevel(run, levelOf);

  const answeredPerSkill = new Map<string, number>();
  for (const r of run.responses) if (r.outcome !== "skipped") answeredPerSkill.set(r.skillId, (answeredPerSkill.get(r.skillId) ?? 0) + 1);
  const askedPerSkill = new Map<string, number>();
  for (const r of run.responses) askedPerSkill.set(r.skillId, (askedPerSkill.get(r.skillId) ?? 0) + 1);

  const goals = new Set(run.goalSkillIds);
  const goalTopics = new Set(run.goalSkillIds.map((g) => byId.get(g)?.topic).filter(Boolean) as string[]);

  // Prerequisite probing: sample the foundations of skills already asked, harder if they were missed.
  const probe = new Map<string, number>();
  for (const r of run.responses) {
    if (r.outcome === "skipped") continue;
    const bonus = r.outcome === "incorrect" ? w.probeIncorrect : w.probeCorrect;
    for (const pre of byId.get(r.skillId)?.prerequisites ?? []) probe.set(pre, Math.max(probe.get(pre) ?? 0, bonus));
  }

  const coveredLevels = new Set(run.responses.filter((r) => r.outcome !== "skipped").map((r) => levelOf(r.skillId)));
  const topicCounts = new Map<string, number>();
  for (const r of run.responses) {
    const t = byId.get(r.skillId)?.topic;
    if (t) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  }
  const lastTopic = run.responses.length > 0 ? byId.get(run.responses[run.responses.length - 1].skillId)?.topic : undefined;

  let bestSkill: { skill: CurriculumSkill; score: number } | null = null;
  for (const skill of skills) {
    const answered = answeredPerSkill.get(skill.id) ?? 0;
    const asked = askedPerSkill.get(skill.id) ?? 0;
    // One answered item per skill; a skipped item may be replaced once by another.
    if (answered >= DIAGNOSTIC_CONFIG.maxPerSkill || asked >= DIAGNOSTIC_CONFIG.maxPerSkill + 1) continue;
    if (!pool.some((p) => p.skillId === skill.id && !askedItems.has(p.id))) continue;

    const lvl = levelNumber(skill.cefr);
    let score = w.proximity - w.proximityPerLevel * Math.abs(lvl - L);
    if (goals.has(skill.id)) score += w.goal;
    else if (goalTopics.has(skill.topic)) score += w.goalTopic;
    score += probe.get(skill.id) ?? 0;
    if (!coveredLevels.has(lvl)) score += w.coverage;
    if (lastTopic === skill.topic) score += w.sameTopic;
    if ((topicCounts.get(skill.topic) ?? 0) >= 2) score += w.repeatedTopic;

    const better =
      !bestSkill ||
      score > bestSkill.score ||
      (score === bestSkill.score && (order.get(skill.id) ?? 0) < (order.get(bestSkill.skill.id) ?? 0));
    if (better) bestSkill = { skill, score };
  }
  if (!bestSkill) return null;

  const target = L >= levelNumber(bestSkill.skill.cefr) + 0.5 ? 2 : 1;
  const items = pool
    .filter((p) => p.skillId === bestSkill!.skill.id && !askedItems.has(p.id))
    .sort(
      (a, b) =>
        Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target) ||
        TYPE_PREFERENCE.indexOf(a.question.type) - TYPE_PREFERENCE.indexOf(b.question.type) ||
        a.questionId.localeCompare(b.questionId),
    );
  return items[0] ?? null;
}

/** Grades a diagnostic answer with the same deterministic grader the lessons use. */
export function gradeDiagnosticAnswer(item: DiagnosticItem, answer: string): "correct" | "incorrect" {
  return evaluateAnswer(item.question, answer).verdict === "correct" ? "correct" : "incorrect";
}

export function recordResponse(run: DiagnosticRun, item: DiagnosticItem, outcome: ItemOutcome, now: number): DiagnosticRun {
  if (run.finishedAt !== null && !run.extended) return run;
  if (run.responses.some((r) => r.itemId === item.id)) return run;
  const next: DiagnosticRun = {
    ...run,
    responses: [...run.responses, { itemId: item.id, skillId: item.skillId, outcome, at: now }],
  };
  return stopStatus(next).done ? { ...next, finishedAt: now } : next;
}

export function diagnosticEvents(run: DiagnosticRun): EvidenceEvent[] {
  return run.responses
    .filter((r) => r.outcome !== "skipped")
    .map((r) => ({
      skillId: r.skillId,
      outcome: r.outcome === "correct" ? ("correct_first_try" as const) : ("incorrect" as const),
      source: "diagnostic" as const,
      groupId: run.id,
      questionKey: r.itemId,
      at: r.at,
    }));
}
