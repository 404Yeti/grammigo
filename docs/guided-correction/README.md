# Guided Correction (v0.3): material for educator review

**Status: PROVISIONAL. Nothing here is validated by an educator. None of it may be released publicly until it has been.**
The release gate (`src/features/guided/release.ts`) reports `releasable: false` and a test keeps it that way until every blocker is cleared.

## What needs review

| File | Contents | Reviewer action |
|---|---|---|
| `labels-for-review.csv` | All 491 labelled learner sentences (dev 195, held-out-1 110, held-out-2 91, unseen held-out-3 95) with the label I assigned, plus what evaluator v1.0.0 returned. | Fill `reviewer_verdict` (agree / disagree / unsure), and `reviewer_corrected_label` where you disagree. |
| `explanations-for-review.csv` | Every authored question, model answer, hint-ladder rung, "understand" reason, neutral message and voice message. | Fill `reviewer_verdict` (approve / revise / reject) and a revised text. |
| `holdout3-first-pass.json` | First-pass result of the evaluator on the unseen set 3, recorded once. | Read-only record. |

The labels were written by the developer (an AI model working with the owner), not by an English teacher. Treat each label as a hypothesis.
Questions that matter most: are the "incorrect" labels really errors a teacher would flag *for this skill* (past simple vs present perfect)? Are any "correct" labels wrong? Are the model answers natural? Are the hints accurate, not misleading, and pitched at the right level?

## Evaluator freeze

The deterministic evaluator rules are frozen at **1.0.0** (`src/features/guided/evaluator/FROZEN.json`, SHA-256 checked by a test).
A change to a rule file fails that test. A rule change requires: a version bump, a *new* unseen set, one untuned run, owner approval.
Sets dev, held-out-1 and held-out-2 were used while building the rules and are regression sets only. Set 3 was written after the freeze and run once.

## Outcome weights

First try 1.0, self-corrected 0.7, hint-assisted 0.5, shown 0, unverified = no value are **provisional**, unvalidated, and kept entirely separate from mastery, the profile and recommendations.

## Regenerating

`GUIDED_REVIEW_EXPORT=1 npx vitest run src/features/guided/review-export.test.ts` rewrites the two CSVs. A normal test run fails if they drift from the corpus or content.
