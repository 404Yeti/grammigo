import type { Session, SessionStatus } from "@/types/session";

/** A valid persisted regular-lesson record; tests vary only completion evidence. */
export function activitySession(id: string, at: number | null, status: SessionStatus = "completed"): Session {
  return {
    id, lessonId: "a1-be-present", status, startedAt: (at ?? 0) - 1000,
    completedAt: at, updatedAt: at ?? 0, activeMs: 1000, lastActiveAt: at ?? 0,
    currentIndex: 0, phase: "feedback", draft: "",
    records: [{ questionId: "q1", attempts: [], hintsUsed: 0, whyViewed: false,
      classification: "correct_first_try", resolution: "correct", finalAnswer: "is" }],
  };
}
