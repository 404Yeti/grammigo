/** Exactly the attempt classifications from the Figma developer notes. */
export type Classification =
  | "correct_first_try"
  | "correct_after_hint"
  | "correct_after_retry"
  | "incorrect";

export type AttemptVerdict = "correct" | "incorrect" | "needs_review";

export interface AttemptRecord {
  answer: string;
  verdict: AttemptVerdict;
  at: number;
  hintsUsedBefore: number;
  message?: string;
}

/** How a question ended. "open" while the learner is still working on it. */
export type Resolution = "open" | "correct" | "exhausted" | "needs_review";

export interface QuestionRecord {
  questionId: string;
  attempts: AttemptRecord[];
  hintsUsed: number;
  whyViewed: boolean;
  /**
   * null while open, and for answers that could not be evaluated reliably
   * (free writing). Those are never counted as correct or incorrect.
   */
  classification: Classification | null;
  resolution: Resolution;
  finalAnswer: string | null;
}

export type SessionStatus = "in_progress" | "completed" | "abandoned";
export type Phase = "answering" | "feedback";

export interface Session {
  id: string;
  lessonId: string;
  status: SessionStatus;
  startedAt: number;
  completedAt: number | null;
  updatedAt: number;
  /** Active practice time; long idle gaps are capped so leaving the app does not inflate it. */
  activeMs: number;
  lastActiveAt: number;
  currentIndex: number;
  phase: Phase;
  draft: string;
  records: QuestionRecord[];
}

/** User-facing lesson lifecycle, derived from a session (see deriveLessonState). */
export type LessonState =
  | "not_started"
  | "in_progress"
  | "awaiting_answer"
  | "showing_feedback"
  | "completed";

export interface StoredState {
  version: 1;
  sessions: Session[];
  activeSessionId: string | null;
}
