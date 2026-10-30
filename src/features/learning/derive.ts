import { listSkills } from "@/curriculum";
import { getLesson } from "@/data/lessons";
import { diagnosticEvents } from "@/features/diagnostic/engine";
import type { StoredState } from "@/types/session";
import { lessonEvents } from "./events";
import { computeAllMastery, type EvidenceEvent, type SkillMastery } from "./mastery";
import { buildProfile, type LearningProfile } from "./profile";
import { explainRecommendationChange, recommendLessons, type Recommendation, type RecommendationSnapshot } from "./recommend";
import { summarizeSession } from "@/features/practice/summary";
import { requireSkill } from "@/curriculum";

export interface Learning {
  events: EvidenceEvent[];
  mastery: Map<string, SkillMastery>;
  profile: LearningProfile;
  recommendations: Recommendation[];
  /** The single immediate suggestion. Null only if the catalog is empty. */
  top: Recommendation | null;
}

/**
 * Everything the app knows about the learner, derived on demand from saved history.
 * Mastery is never stored separately, so it can't drift from the attempt history.
 */
export function deriveLearning(state: StoredState, now: number): Learning {
  const skills = listSkills();
  const events = [
    ...lessonEvents(state.sessions, getLesson),
    ...state.diagnosticRuns.flatMap(diagnosticEvents),
  ];
  const mastery = computeAllMastery(skills.map((s) => s.id), events, now);
  const goalSkillIds = state.goals?.skillIds ?? [];
  const profile = buildProfile({ skills, mastery, goalSkillIds, now });
  const recommendations = recommendLessons({ skills, mastery, goalSkillIds, now });
  return { events, mastery, profile, recommendations, top: recommendations[0] ?? null };
}

export function snapshotOf(rec: Recommendation | null, now: number): RecommendationSnapshot | null {
  return rec ? { skillId: rec.skillId, kind: rec.kind, at: now } : null;
}

/**
 * The reason for the current recommendation. If the learner finished a lesson since the last
 * recommendation was recorded, it also says what changed and why.
 */
export function explainNextStep(state: StoredState, learning: Learning): string {
  const top = learning.top;
  if (!top) return "";
  const previous = state.lastRecommendation;
  const latest = state.sessions
    .filter((s) => s.status === "completed")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  if (!previous || !latest || (latest.completedAt ?? 0) <= previous.at) return top.reason;
  const sum = summarizeSession(latest);
  return explainRecommendationChange({
    previous,
    next: top,
    titleOf: (id) => requireSkill(id).title,
    lastLesson: { skillId: latest.lessonId, independent: sum.independent, assisted: sum.assisted, incorrect: sum.incorrect, total: sum.total },
  });
}
