/** Bounds for one Guided Correction exercise. Changing any of these is a teaching decision, not a refactor. */
export const GUIDED_LIMITS = {
  /** Retries after the first deterministically-incorrect answer. Show me is always available. */
  maxRetries: 3,
  /** The transfer exercise measures independent ability: one nudge, one retry, no hint ladder. */
  transferRetries: 1,
  /** AI second opinions per exercise (and at most one per answer). */
  maxOpinions: 2,
  /** Neutral, ungraded clarifications per exercise. */
  maxClarifications: 1,
  /** Consecutive answers with nothing to judge before the exercise ends as unverified (no penalty). */
  maxNonAttempts: 3,
  /** Stored sessions kept on the device. The oldest finished ones are dropped first. */
  maxSessions: 100,
  /** Longest answer text kept in history. */
  maxStoredText: 600,
} as const;
