# Guided Correction (v0.3): material for educator review

**Status: PROVISIONAL. Nothing here is validated by an educator. None of it may be released publicly until it has been.**
The release gate (`src/features/guided/release.ts`) reports `releasable: false` and a test keeps it that way until every blocker is cleared.

## What needs review

| File | Contents | Reviewer action |
|---|---|---|
| `labels-for-review.csv` | All 580 labelled learner sentences (dev 195, held-out-1 110, held-out-2 91, held-out-3 95 (seen), unseen held-out-4 89) with the label I assigned, what evaluator v1.1.0 returned, whether they match, and a `flag` column. | Fill `reviewer_verdict` (agree / disagree / unsure), and `reviewer_corrected_label` where you disagree. |
| `explanations-for-review.csv` | Every authored question, model answer, hint-ladder rung, "understand" reason, neutral message, voice message, and (Phase 3) every line of on-screen wording and outcome message. | Fill `reviewer_verdict` (approve / revise / reject) and a revised text. |
| `holdout3-first-pass.json` | First-pass result of the evaluator on the unseen set 3, recorded once. | Read-only record. |

The labels were written by the developer (an AI model working with the owner), not by an English teacher. Treat each label as a hypothesis.
Questions that matter most: are the "incorrect" labels really errors a teacher would flag *for this skill* (past simple vs present perfect)? Are any "correct" labels wrong? Are the model answers natural? Are the hints accurate, not misleading, and pitched at the right level?

## Open educator-review items from the unseen set (review these first)

The rules were frozen before set 3 was written and were **not tuned** on it. First-pass failures, exactly as recorded in `holdout3-first-pass.json`:

| # | Sentence | Label | Evaluator said | Why it matters |
|---|---|---|---|---|
| 1 | **I have learned English for I was a child.** | incorrect · `since_for_confusion` | **correct** (accepted) | The only sentence a learner would be wrongly told is fine. |
| 2 | I learn English since four years. | incorrect · `since_without_perfect` | incorrect · `since_for_confusion` | Two errors in one sentence; which should be shown first? |
| 3 | I have began to learn English two years ago. | incorrect · `participle_form` | incorrect · `pp_with_finished_time` | Two errors in one sentence; which should be shown first? |
| 4 | I study English since I was twelve. | incorrect · `since_without_perfect` | uncertain | A miss, not a wrong verdict: the learner is not told they are right. |

These four are also listed in code (`OPEN_REVIEW_ITEMS` in `src/features/guided/release.ts`, returned by `guidedReleaseStatus().reviewItems`) and flagged `REVIEW FIRST` in `labels-for-review.csv`. A test checks the list matches the recorded first pass.

Investigation, root causes, a **proposed (not applied)** rule change and its measured effect: `evaluator-investigation.md`, `proposals/`.

## Phase 4 live AI checks (development configuration, nothing deployed)

`live-ai-check.json` (12 calls: schema, latency, tokens, timeout, guards) and `live-ai-corpus.json` (every labelled sentence the on-device check leaves uncertain, 53 calls). Both measure; neither tunes anything. Read the "false guidance" rows in the corpus file with an educator: the AI sometimes raises a grammar concern about a sentence that is fine.

## Evaluator freeze

The deterministic evaluator rules are frozen at **1.1.0** (`src/features/guided/evaluator/FROZEN.json`, SHA-256 checked by a test).
A change to a rule file fails that test. A rule change requires: a version bump, a *new* unseen set, one untuned run, owner approval.
Sets dev, held-out-1 and held-out-2 were used while building the rules and are regression sets only. Set 3 was written after the freeze and run once.

## Outcome weights

First try 1.0, self-corrected 0.7, hint-assisted 0.5, shown 0, unverified = no value are **provisional**, unvalidated, and kept entirely separate from mastery, the profile and recommendations.

## Regenerating

`GUIDED_REVIEW_EXPORT=1 npx vitest run src/features/guided/review-export.test.ts` rewrites the two CSVs. A normal test run fails if they drift from the corpus or content.

## Visibility

In a production build the activity is hidden (no entry card, `/practice/<lesson>/guided` is a 404) until the release gate is clear. A preview build opts in with `NEXT_PUBLIC_GUIDED_PREVIEW=true`. Spoken answers are a separate switch, `NEXT_PUBLIC_GUIDED_VOICE=true`, **off in production builds** (typed-only) until real-device testing is done. The full browser suite needs `NEXT_PUBLIC_GUIDED_PREVIEW=true NEXT_PUBLIC_GUIDED_VOICE=true npm run build`; the release configuration is `NEXT_PUBLIC_GUIDED_PREVIEW=true` alone, tested with the spoken tests excluded.

## Phase 5 additions

* **`educator-review-priority.md`**: start here. The riskiest wording and labels first; both CSVs are sorted the same way (`review_priority` column).
* **Evaluator 1.1.0** (owner-approved: `for`/`since` + clause rules) is frozen; set 3 is now *seen*; set 4 (89 sentences) was written after the freeze and run once, untuned: `holdout4-first-pass.json`.
* **`real-device-test-checklist.md`** and `real-device-results.template.csv`: the checklist for real hardware. **Not run.** The release gate has a fifth blocker, `real-device-testing-pending`.
* **Outcome weights** (1.0 / 0.7 / 0.5 / 0) are provisional *activity* metrics for Guided Correction only. They are not mastery, not a proficiency or level estimate, and must not be quoted as one. A test scans the learner-facing wording for such claims.
