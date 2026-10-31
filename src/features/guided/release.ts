import { GUIDED_PILOT } from "@/curriculum/guided";

/**
 * Release gate for Guided Correction. The evaluator, the corpus labels and every authored word
 * are provisional until an educator has validated them. While any blocker is open the feature must
 * not be shown to learners in a public release; a later UI phase reads this to stay hidden.
 */
export const EVALUATOR_VERSION = "1.1.0";

export interface ReleaseBlocker {
  id: "educator-review-content" | "educator-review-labels" | "outcome-weights-unvalidated" | "unseen-validation-pending" | "real-device-testing-pending";
  detail: string;
}

/** A specific sentence the frozen evaluator got wrong on the unseen set. Kept visible until an educator has ruled on it. */
export interface ReviewItem {
  id: string;
  sentence: string;
  itemId: string;
  kind: "incorrectly_accepted" | "wrong_category" | "missed_error" | "label_error" | "valid_not_recognised";
  /** Which labelled set it came from (3 and 4 are the unseen sets). */
  set: "3" | "4";
  /** open: needs an educator's ruling · addressed: a rule change covers it, the educator still confirms · author_error: the label itself is wrong. */
  status: "open" | "addressed_in_1.1.0" | "author_error";
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
    set: "3",
    status: "addressed_in_1.1.0",
    labelled: "incorrect · since_for_confusion (“for” should be “since”)",
    evaluatorSaid: "correct (present perfect recognised; “for” + a clause was not caught)",
    question: "Is “for I was a child” a since/for error you want flagged? If so the rule must catch “for” + a clause.",
  },
  {
    id: "h3-wrong-category-learn-since-four-years",
    sentence: "I learn English since four years.",
    itemId: "ppps-transfer-unfinished",
    kind: "wrong_category",
    set: "3",
    status: "open",
    labelled: "incorrect · since_without_perfect (present simple used with a duration)",
    evaluatorSaid: "incorrect · since_for_confusion (“since” with a duration)",
    question: "The sentence has two errors. Which one should the learner be shown first?",
  },
  {
    id: "h3-wrong-category-began-ago",
    sentence: "I have began to learn English two years ago.",
    itemId: "ppps-transfer-unfinished",
    kind: "wrong_category",
    set: "3",
    status: "open",
    labelled: "incorrect · participle_form (“began” should be “begun”)",
    evaluatorSaid: "incorrect · pp_with_finished_time (present perfect with “two years ago”)",
    question: "The sentence has two errors. Which one should the learner be shown first?",
  },
  {
    id: "h3-missed-study-since-twelve",
    sentence: "I study English since I was twelve.",
    itemId: "ppps-transfer-unfinished",
    kind: "missed_error",
    set: "3",
    status: "addressed_in_1.1.0",
    labelled: "incorrect · since_without_perfect",
    evaluatorSaid: "uncertain (no tense evidence); the learner is never wrongly told they are right, but is not helped either",
    question: "Confirm the label. The deterministic check leaves this to the (ungraded) second opinion.",
  },
  // ── first pass of evaluator 1.1.0 on the fresh unseen set 4 (docs/guided-correction/holdout4-first-pass.json). Not tuned.
  {
    id: "h4-label-error-swum",
    sentence: "I have swum in the sea twice this month.",
    itemId: "ppps-main",
    kind: "label_error",
    set: "4",
    status: "author_error",
    labelled: "incorrect · participle_form (author's mistake)",
    evaluatorSaid: "uncertain (perfect without a finished time). “swum” IS the correct participle, so the sentence is valid; the label is wrong.",
    question: "Confirm the sentence is valid. The label is left as written so the first-pass record stays exact.",
  },
  {
    id: "h4-missed-practise-since-we-met",
    sentence: "We practise English together since we met.",
    itemId: "ppps-transfer-unfinished",
    kind: "missed_error",
    set: "4",
    status: "open",
    labelled: "incorrect · since_without_perfect",
    evaluatorSaid: "uncertain. The 1.1.0 “since + clause” rule lists a small set of verbs (was, started, moved…); “met” is not on it.",
    question: "Confirm the label. Widening the verb list is a candidate for a later, separately validated version (not applied).",
  },
  {
    id: "h4-wrong-category-began-last-month",
    sentence: "I have began my English course last month.",
    itemId: "ppps-transfer-unfinished",
    kind: "wrong_category",
    set: "4",
    status: "open",
    labelled: "incorrect · participle_form (“began” should be “begun”)",
    evaluatorSaid: "incorrect · pp_with_finished_time (present perfect with “last month”)",
    question: "Same two-error ordering question as the set-3 case: which error is shown first?",
  },
  {
    id: "h4-valid-not-recognised-about-two-years",
    sentence: "About two years, maybe a bit more.",
    itemId: "ppps-transfer-unfinished",
    kind: "valid_not_recognised",
    set: "4",
    status: "open",
    labelled: "correct (a natural short answer)",
    evaluatorSaid: "uncertain (no tense evidence). Never wrong, but the learner is sent to the second opinion unnecessarily.",
    question: "Confirm the sentence is a good answer. The hedge “maybe a bit more” defeats the short-answer pattern.",
  },
];

/** Flip these only when the named validation has really happened and been signed off. */
export const VALIDATION_SIGNOFF = {
  authoredContent: false,
  corpusLabels: false,
  outcomeWeights: false,
  unseenSetPassed: false,
  /** Flip only after the checklist in docs/guided-correction/real-device-test-checklist.md has been run on real hardware and recorded. */
  realDevices: false,
} as const;

export function guidedReleaseStatus(): ReleaseStatus {
  const blockers: ReleaseBlocker[] = [];
  const unapproved = GUIDED_PILOT.items.filter((i) => i.contentStatus !== "educator-approved");
  if (!VALIDATION_SIGNOFF.authoredContent || unapproved.length > 0) {
    blockers.push({ id: "educator-review-content", detail: `${unapproved.length} of ${GUIDED_PILOT.items.length} authored items (and all hint ladders) are awaiting educator review.` });
  }
  if (!VALIDATION_SIGNOFF.corpusLabels) blockers.push({ id: "educator-review-labels", detail: "The labelled evaluator corpus was written by an engineer; an educator must review every label." });
  if (!VALIDATION_SIGNOFF.outcomeWeights) blockers.push({ id: "outcome-weights-unvalidated", detail: "The 1.0 / 0.7 / 0.5 / 0 outcome weights are provisional and kept apart from mastery." });
  if (!VALIDATION_SIGNOFF.unseenSetPassed) blockers.push({ id: "unseen-validation-pending", detail: "The frozen evaluator has first-pass results on unseen sets 3 and 4; validation against educator-reviewed labels is pending." });
  if (!VALIDATION_SIGNOFF.realDevices) blockers.push({ id: "real-device-testing-pending", detail: "Voice has only been tested with Chromium's fake microphone. iPhone Safari and other real devices have not been tested; browser emulation does not count." });
  return { releasable: blockers.length === 0, blockers, reviewItems: OPEN_REVIEW_ITEMS };
}
