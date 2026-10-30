import type { Session } from "@/types/session";

export interface SessionSummary {
  total: number;
  /** Questions with a final resolution. */
  completed: number;
  correctFirstTry: number;
  correctAfterHint: number;
  correctAfterRetry: number;
  incorrect: number;
  /** Answers we could not evaluate reliably (free writing). Never counted as right or wrong. */
  needsReview: number;
  /** correct_first_try only. */
  independent: number;
  /** correct_after_hint + correct_after_retry. */
  assisted: number;
  hintsUsed: number;
  retries: number;
  elapsedMs: number;
}

export function summarizeSession(session: Session): SessionSummary {
  const summary: SessionSummary = {
    total: session.records.length,
    completed: 0,
    correctFirstTry: 0,
    correctAfterHint: 0,
    correctAfterRetry: 0,
    incorrect: 0,
    needsReview: 0,
    independent: 0,
    assisted: 0,
    hintsUsed: 0,
    retries: 0,
    elapsedMs: session.activeMs,
  };

  for (const record of session.records) {
    summary.hintsUsed += record.hintsUsed;
    summary.retries += Math.max(0, record.attempts.length - 1);
    if (record.resolution === "open") continue;
    summary.completed += 1;
    if (record.resolution === "needs_review") {
      summary.needsReview += 1;
      continue;
    }
    switch (record.classification) {
      case "correct_first_try":
        summary.correctFirstTry += 1;
        break;
      case "correct_after_hint":
        summary.correctAfterHint += 1;
        break;
      case "correct_after_retry":
        summary.correctAfterRetry += 1;
        break;
      case "incorrect":
        summary.incorrect += 1;
        break;
    }
  }
  summary.independent = summary.correctFirstTry;
  summary.assisted = summary.correctAfterHint + summary.correctAfterRetry;
  return summary;
}

/** "6 min" style label for the success tile: whole minutes, or seconds under a minute. */
export function formatElapsed(ms: number): { value: number; unit: "minutes" | "seconds" } {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return { value: seconds, unit: "seconds" };
  return { value: Math.round(seconds / 60), unit: "minutes" };
}

/** Honest, deterministic achievement line based on what actually happened. */
export function achievementMessage(summary: SessionSummary): string {
  if (summary.independent === summary.total) {
    return "A clean run: every answer on your own!";
  }
  if (summary.incorrect > 0) {
    return "Some answers were tricky, and that’s useful: your review shows exactly what to practice next.";
  }
  if (summary.assisted > 0) {
    return "You turned every stumble into a correct answer. That’s how grammar sticks.";
  }
  return "Nice work finishing the lesson.";
}
