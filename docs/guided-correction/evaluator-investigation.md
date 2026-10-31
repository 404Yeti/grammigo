# Investigation of the four flagged evaluator cases (evaluator 1.0.0, FROZEN)

**Nothing in the frozen evaluator was changed.** This is analysis plus a *proposal* that needs owner approval. The prototype ran in a throw-away copy
and was deleted; the exact change is in `proposals/evaluator-1.1.0-analyze.patch` and its measured effect in `proposals/evaluator-1.1.0-measured.json`.

## Root causes

| # | Sentence | Why the frozen rules behave this way |
|---|---|---|
| 1 | **I have learned English for I was a child.** (accepted) | The unfinished-frame check returns `correct` as soon as a present perfect is found. The only `for`-with-a-point-in-time rule knows years (`for 2018`) and `for last …`; it has no pattern for `for` + a clause (`for I was…`). So nothing flags it. |
| 2 | I learn English since four years. (category) | `since_for_confusion` is checked before `since_without_perfect` ("the more specific diagnosis"). Both errors are present; the rules show the since/for one first. |
| 3 | I have began to learn English two years ago. (category) | By design (comment in `evaluate.ts`): tense choice comes before verb form. Both errors are present; the tense one is shown first. |
| 4 | I study English since I was twelve. (missed) | `since_without_perfect` only fires for `since` + a year/month/weekday/`last …`. A `since` + clause ("since I was twelve") is not recognised, so the answer ends `uncertain / no_tense_evidence`. The same hole explains two earlier known misses ("I speak English since I was a child.", "I played the piano since I was seven."). |

## Recommendation

* **Cases 1 and 4 are rule gaps** (a wrong answer the learner is not told about, or only gets an ungraded second opinion). Proposal **P1** teaches `for` + clause as a starting point; **P2** teaches `since` + clause after a finite main verb with no perfect in the sentence.
* **Cases 2 and 3 are label questions, not rule bugs.** Each sentence has two real errors, and the rules deliberately pick one. For case 3 the evaluator's choice is the better lesson: switching to the past simple ("I began … two years ago") removes the participle error as well. I recommend **relabelling case 3** and asking the educator to rule on case 2 (either order is defensible; if tense-first is wanted, a one-line reorder is a possible P3, not included).

## Measured effect of P1 + P2 (on a scratch copy; all 491 labelled sentences)

| | frozen 1.0.0 | proposed 1.1.0 |
|---|---|---|
| wrongly marked incorrect | 0 | 0 |
| target errors detected | 146 / 151 | 150 / 151 |
| errors accepted as correct | 1 | 0 |
| valid answers recognised | 260 / 261 | 260 / 261 |
| unrelated errors ignored | 11 / 11 | 11 / 11 |

Four sentences change, all in the intended direction: the four cases above plus the two earlier known misses; nothing else moves.

## Caveats (read before approving)

* The proposal was written **after** seeing these failures, so the numbers above are not an unbiased estimate. Set 3 is now "seen"; a fresh unseen set 4 must be written and run once, untuned, before any 1.1.0 claim.
* Applying it means bumping the version, regenerating `FROZEN.json`, and the freeze test will (correctly) force that.
* Risk to check with an educator: `for I/we/he/she/they …` is never valid as a preposition phrase; `since I/we… was/started/…` after a main verb with no perfect is wrong for this level. Literary uses ("for he was tired") are out of scope for A2–B1.
