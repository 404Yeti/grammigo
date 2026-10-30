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

/** The shape saved by v0.1. Only used when migrating. */
export interface StoredStateV1 {
  version: 1;
  sessions: Session[];
  activeSessionId: string | null;
}

export type StoredState = StoredStateV2;

/* ---------------------------------------------------------------- v0.2 */

import type { DiagnosticRun } from "@/features/diagnostic/engine";
import type { RecommendationSnapshot } from "@/features/learning/recommend";

export interface GoalItem {
  label: string;
  skillIds: string[];
}

/** What the learner said they want to improve, interpreted into curriculum skills. */
export interface LearnerGoals {
  text: string;
  source: "typed" | "spoken" | "none";
  goals: GoalItem[];
  /** All candidate skill ids, validated against the catalog. */
  skillIds: string[];
  /** "ai" when OpenAI interpreted it, "local" for the offline keyword matcher, "none" for a general check. */
  extractedBy: "ai" | "local" | "none";
  updatedAt: number;
}

export type OnboardingStep = "welcome" | "concerns" | "transcript" | "confirm" | "quiz" | "profile" | "recommendation";
export type OnboardingStatus = "not_started" | "in_progress" | "completed" | "skipped";

export interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  /** Text typed or transcribed, kept so a refresh never loses it. */
  draftText: string;
  draftSource: "typed" | "spoken";
  runId: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface WritingFeedbackErrorItem {
  original: string;
  correction: string;
  explanation: string;
}

export interface StoredWritingFeedback {
  status: "ready" | "unavailable";
  at: number;
  outcome?: "meets_goal" | "needs_work" | "unclear";
  confidence?: "low" | "medium" | "high";
  errors?: WritingFeedbackErrorItem[];
  suggestedCorrection?: string | null;
  explanation?: string;
  example?: string | null;
}

export interface StoredStateV2 {
  version: 2;
  sessions: Session[];
  activeSessionId: string | null;
  onboarding: OnboardingState;
  goals: LearnerGoals | null;
  diagnosticRuns: DiagnosticRun[];
  lastRecommendation: RecommendationSnapshot | null;
  /** Optional AI writing feedback, keyed by "sessionId:questionId". */
  writingFeedback: Record<string, StoredWritingFeedback>;
}
