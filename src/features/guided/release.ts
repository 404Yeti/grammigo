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

/** A specific sentence the frozen evaluator got wrong on the unseen set. Kept visible until an educator has ruled on it. */
export interface ReviewItem {
  id: string;
  sentence: string;
  itemId: string;
  kind: "incorrectly_accepted" | "wrong_category" | "missed_error";
  labelled: string;
  evaluatorSaid: string;
  question: string;
}

export interface ReleaseStatus {
  releasable: boolean;
  blockers: ReleaseBlocker[];
  /** Open educator-review items. They do not change at runtime; they exist so the problem stays in front of reviewers. */
  reviewItems: readonly ReviewItem[];
}

/**
 * First-pass failures on the 95-sentence unseen set (docs/guided-correction/holdout3-first-pass.json).
 * The rules were NOT tuned on them. Each needs an educator's ruling on the label AND on whether the rule should change.
 */
export const OPEN_REVIEW_ITEMS: readonly ReviewItem[] = [
  {
    id: "h3-accepted-for-i-was-a-child",
    sentence: "I have learned English for I was a child.",
    itemId: "ppps-transfer-unfinished",
    kind: "incorrectly_accepted",
    labelled: "incorrect · since_for_confusion (“for” should be “since”)",
    evaluatorSaid: "correct (present perfect recognised; “for” + a clause was not caught)",
    question: "Is “for I was a child” a since/for error you want flagged? If so the rule must catch “for” + a clause.",
  },
  {
    id: "h3-wrong-category-learn-since-four-years",
    sentence: "I learn English since four years.",
    itemId: "ppps-transfer-unfinished",
    kind: "wrong_category",
    labelled: "incorrect · since_without_perfect (present simple used with a duration)",
    evaluatorSaid: "incorrect · since_for_confusion (“since” with a duration)",
    question: "The sentence has two errors. Which one should the learner be shown first?",
  },
  {
    id: "h3-wrong-category-began-ago",
    sentence: "I have began to learn English two years ago.",
    itemId: "ppps-transfer-unfinished",
    kind: "wrong_category",
    labelled: "incorrect · participle_form (“began” should be “begun”)",
    evaluatorSaid: "incorrect · pp_with_finished_time (present perfect with “two years ago”)",
    question: "The sentence has two errors. Which one should the learner be shown first?",
  },
  {
    id: "h3-missed-study-since-twelve",
    sentence: "I study English since I was twelve.",
    itemId: "ppps-transfer-unfinished",
    kind: "missed_error",
    labelled: "incorrect · since_without_perfect",
    evaluatorSaid: "uncertain (no tense evidence); the learner is never wrongly told they are right, but is not helped either",
    question: "Confirm the label. The deterministic check leaves this to the (ungraded) second opinion.",
  },
];

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
  return { releasable: blockers.length === 0, blockers, reviewItems: OPEN_REVIEW_ITEMS };
}
