/**
 * Which kind of question the item asks; it decides which answers are natural and acceptable.
 *  - finished: the question names a finished time ("What did you do yesterday evening?"): past simple expected.
 *  - unfinished: "How long have you…?": present perfect, or a natural short answer ("For three years.").
 *  - experience: "Have you ever…?": present perfect, or a past simple answer with details.
 */
export const FRAMES = ["finished", "unfinished", "experience"] as const;
export type Frame = (typeof FRAMES)[number];

export type Verdict = "correct" | "incorrect" | "uncertain";

/** Target-skill error categories. Anything else (spelling, articles…) is never a target error. */
export const TARGET_CATEGORIES = ["pp_with_finished_time", "participle_form", "since_without_perfect", "since_for_confusion"] as const;
export type TargetCategory = (typeof TARGET_CATEGORIES)[number];

/** Why an `uncertain` verdict was reached, when a likely category is known. Never counted against the learner. */
export type Suspected = TargetCategory | "pp_without_marker" | "past_simple_for_ongoing" | "present_with_for" | "present_for_past";

/** The small part of an authored item the evaluator needs. */
export interface EvaluatorItem {
  id: string;
  frame: Frame;
  /** Only these categories can produce an `incorrect` verdict for this item. */
  categories: readonly TargetCategory[];
}

export interface EvaluationInput {
  text: string;
  /** "spoken" means the transcript the learner confirmed or edited, never raw audio output. */
  source: "typed" | "spoken";
}

export interface Evaluation {
  verdict: Verdict;
  /** The target error, for `incorrect` verdicts only. */
  category: TargetCategory | null;
  /** `correct`, but not the form the item is mainly teaching (a fragment, or the past continuous…). */
  validAlternative: boolean;
  /** For `uncertain`: the likely problem, so a later step can route it. Not a verdict. */
  suspected: Suspected | null;
  /** Nothing to judge (empty, no verb, not English): ask for a sentence; never a mistake. */
  notAnAttempt: boolean;
  /** Machine-readable reasons, for tests and diagnostics. Never shown to learners. */
  reasons: string[];
  /** The learner's own time expression, auxiliary and verb, for authored hints. */
  marker: string | null;
  aux: string | null;
  verb: string | null;
}
