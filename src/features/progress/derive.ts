import { getCurriculumSkill } from "@/curriculum";
import { CEFR_LEVELS } from "@/curriculum/schema";
import { hasCompletedActivity } from "@/features/activity/calendar";
import type { Learning } from "@/features/learning/derive";
import type { ProfileEntry } from "@/features/learning/profile";
import type { Session, StoredState } from "@/types/session";

export function evidenceLabel(entry: ProfileEntry): string {
  const m = entry.mastery;
  if (m.score === null) return "Not enough checked evidence";
  if (m.provisional) return "Early evidence";
  if (m.status === "needs_practice") return "Worth reviewing";
  if (m.status === "strong") return "Demonstrated strength";
  return entry.bucket === "strength" ? "Going well" : "Building evidence";
}

/** The latest response is authoritative; never reuse an older success after an unverified retry. */
export function speakingObservation(session: Session, now: number): string | null {
  const challenge = session.speakingChallenge;
  const attempt = challenge?.attempts.at(-1);
  if (!attempt || !Number.isFinite(attempt.at) || attempt.at > now) return null;
  const feedback = attempt.feedback;
  if (!feedback || feedback.confidence === "low" || feedback.outcome === "unclear" || !feedback.assessedSkillIds.includes(session.lessonId)) {
    return "Latest speaking response not verified; this is not a grammar error.";
  }
  if (feedback.outcome === "needs_work") return "Speaking feedback suggests reviewing the target grammar (AI observation).";
  return challenge!.attempts.length > 1
    ? "Target grammar used after a guided retry (AI observation)."
    : "Target grammar used in the speaking response (AI observation).";
}

/** Read-only projection of the SAME scoped state and adaptive profile used by Home. No scores are added. */
export function progressOverview(state: StoredState, learning: Learning, now: number) {
  const completed = state.sessions.filter(s => hasCompletedActivity(s, now) && getCurriculumSkill(s.lessonId))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || a.id.localeCompare(b.id));
  const completedIds = new Set(completed.map(s => s.lessonId));
  // A resolved exercise is practice even when its free-writing answer could not be checked.
  // An abandoned/open-only session is not a completed lesson, nor evidence of weakness.
  const practiced = new Set(state.sessions.filter(s => s.records.some(r => r.resolution !== "open") && s.startedAt <= now).map(s => s.lessonId));
  const topics = learning.profile.entries.filter(e => completedIds.has(e.skillId) || practiced.has(e.skillId) || e.mastery.lastEventAt !== null);
  const levels = CEFR_LEVELS.flatMap(level => {
    const entries = topics.filter(e => e.cefr === level);
    const finished = new Set(completed.filter(s => getCurriculumSkill(s.lessonId)?.cefr === level).map(s => s.lessonId)).size;
    return entries.length || finished ? [{ level, topics: entries.length, completed: finished,
      checked: entries.reduce((sum, e) => sum + e.mastery.independent + e.mastery.assisted + e.mastery.incorrect, 0) }] : [];
  });
  const latestSpeaking = new Map<string, string>();
  for (const s of [...state.sessions].sort((a, b) => (b.speakingChallenge?.attempts.at(-1)?.at ?? 0) - (a.speakingChallenge?.attempts.at(-1)?.at ?? 0))) {
    const observation = speakingObservation(s, now);
    if (observation && !latestSpeaking.has(s.lessonId)) latestSpeaking.set(s.lessonId, observation);
  }
  return { completed, completedLessons: completedIds.size, topics, levels, latestSpeaking };
}
