import { GUIDED_PILOT } from "@/curriculum/guided";

/**
 * Release gate for Guided Correction. The evaluator, the corpus labels and every authored word
 * are provisional until an educator has validated them. While any blocker is open the feature must
 * not be shown to learners in a public release; a later UI phase reads this to stay hidden.
 */
export const EVALUATOR_VERSION = "1.0.0";

export interface ReleaseBlocker {
  id: "educator-review-content" | "educator-review-labels" | "outcome-weights-unvalidated" | "unseen-validation-pending";
  detail: string;
}

export interface ReleaseStatus {
  releasable: boolean;
  blockers: ReleaseBlocker[];
}

/** Flip these only when the named validation has really happened and been signed off. */
export const VALIDATION_SIGNOFF = {
  authoredContent: false,
  corpusLabels: false,
  outcomeWeights: false,
  unseenSetPassed: false,
} as const;

export function guidedReleaseStatus(): ReleaseStatus {
  const blockers: ReleaseBlocker[] = [];
  const unapproved = GUIDED_PILOT.items.filter((i) => i.contentStatus !== "educator-approved");
  if (!VALIDATION_SIGNOFF.authoredContent || unapproved.length > 0) {
    blockers.push({ id: "educator-review-content", detail: `${unapproved.length} of ${GUIDED_PILOT.items.length} authored items (and all hint ladders) are awaiting educator review.` });
  }
  if (!VALIDATION_SIGNOFF.corpusLabels) blockers.push({ id: "educator-review-labels", detail: "The labelled evaluator corpus was written by an engineer; an educator must review every label." });
  if (!VALIDATION_SIGNOFF.outcomeWeights) blockers.push({ id: "outcome-weights-unvalidated", detail: "The 1.0 / 0.7 / 0.5 / 0 outcome weights are provisional and kept apart from mastery." });
  if (!VALIDATION_SIGNOFF.unseenSetPassed) blockers.push({ id: "unseen-validation-pending", detail: "The frozen evaluator has a first-pass result on an unseen set; validation against educator-reviewed labels is pending." });
  return { releasable: blockers.length === 0, blockers };
}
