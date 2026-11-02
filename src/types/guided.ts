import type { Suspected, TargetCategory } from "@/features/guided/evaluator/types";

/**
 * Guided Correction records. These live in their OWN store and are never read by mastery, the
 * learning profile, or recommendations. Nothing here is a lesson classification.
 */

export type GuidedInputSource = "typed" | "spoken";

/** The four activity outcomes, plus "unverified" (could not be judged: carries no value and no penalty). */
export type GuidedOutcomeKind = "first_try" | "self_corrected" | "hint_assisted" | "shown" | "unverified";

/** Where the outcome came from. "ai_second_opinion" is only ever a success the AI helped confirm, never a failure. */
export type OutcomeBasis = "deterministic" | "ai_second_opinion" | "none";

export interface GuidedOutcome {
  kind: GuidedOutcomeKind;
  basis: OutcomeBasis;
  /** How the deciding answer was given; null when no answer decided it (Show me, unverified). */
  source: GuidedInputSource | null;
  at: number;
}

import type { VoiceIssue } from "./voice";
export type { VoiceIssue } from "./voice";

/** What the AI said about an answer the deterministic check could not judge. Validated before use. */
export type OpinionFit = "fits" | "off_prompt" | "incomplete" | "grammar_concern" | "unclear";
export type OpinionConfidence = "low" | "medium" | "high";
export interface StoredOpinion {
  fit: OpinionFit;
  confidence: OpinionConfidence;
  suspected: TargetCategory | null;
}

export interface TranscriptMeta {
  /** What speech-to-text returned. */
  raw: string;
  /** The learner changed the transcript before confirming it. */
  edited: boolean;
  /** Words the transcriber was unsure of. They are flagged to the learner and never counted as an error. */
  lowConfidenceWords: string[];
}

export interface GuidedAttempt {
  /** The text that was judged: typed, or the transcript the learner confirmed. */
  text: string;
  source: GuidedInputSource;
  at: number;
  verdict: "correct" | "incorrect" | "uncertain";
  category: TargetCategory | null;
  suspected: Suspected | null;
  /** Nothing to judge (empty, no verb, not English). Never counts as an attempt or a retry. */
  notAnAttempt: boolean;
  opinion: StoredOpinion | null;
  transcript: TranscriptMeta | null;
}

export type ExercisePhase =
  | "attempting"
  | "recording"
  | "transcribing"
  | "confirming"
  | "checking_opinion"
  | "repairing"
  | "clarifying"
  | "unverified"
  | "offer_show_me"
  | "resolved";

export type ClarifyKind = "incomplete" | "off_prompt" | "grammar_guidance";

export interface LadderContext {
  marker: string | null;
  aux: string | null;
  verb: string | null;
}

export interface GuidedExercise {
  id: string;
  itemId: string;
  kind: "main" | "transfer";
  phase: ExercisePhase;
  /** The phase to go back to if recording or transcribing is cancelled or fails. */
  returnPhase: ExercisePhase;
  inputMode: GuidedInputSource;
  /** Typed draft. */
  draft: string;
  /** A transcript waiting for the learner to confirm or edit it. It is NEVER evaluated until confirmed. */
  pendingTranscript: TranscriptMeta | null;
  voiceIssue: VoiceIssue | null;
  attempts: GuidedAttempt[];
  /** Counted attempts after the first that were deterministically incorrect (bounded). */
  retriesUsed: number;
  /** Highest ladder rung revealed: 0 none, 1 notice, 2 hint 1, 3 hint 2. */
  rung: 0 | 1 | 2 | 3;
  hintsUsed: number;
  category: TargetCategory | null;
  ladder: LadderContext | null;
  clarify: { kind: ClarifyKind; suspected: TargetCategory | null } | null;
  /** A neutral message for the UI after the last submission: nothing to judge, unchanged answer, etc. */
  notice: "not_an_attempt" | null;
  opinionsUsed: number;
  clarificationsUsed: number;
  /** Consecutive non-attempts. Reaching the limit ends the exercise as unverified. */
  nonAttempts: number;
  /** Why an answer could not be judged, for the neutral explanation. */
  unverifiedReason: string | null;
  outcome: GuidedOutcome | null;
  startedAt: number;
  updatedAt: number;
}

export type GuidedStage = "main" | "transfer_intro" | "transfer" | "summary" | "done";

export interface GuidedSession {
  id: string;
  skillId: string;
  status: "in_progress" | "completed" | "abandoned";
  stage: GuidedStage;
  exercises: GuidedExercise[];
  transferDeclined: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export const GUIDED_STORE_VERSION = 1 as const;

export interface GuidedState {
  version: typeof GUIDED_STORE_VERSION;
  sessions: GuidedSession[];
  activeSessionId: string | null;
}
