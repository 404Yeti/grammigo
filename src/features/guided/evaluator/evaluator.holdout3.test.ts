import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOLDOUT3 } from "./corpus/holdout3";
import { runCorpus, summarize } from "./score";

/**
 * UNSEEN set 3. The FIRST run is recorded verbatim in docs/guided-correction/holdout3-first-pass.json and
 * reported as-is; the evaluator is NOT tuned on it. This test asserts NO accuracy thresholds (that would invite
 * tuning). After the first run it only checks that the frozen evaluator still produces the recorded result.
 */
const FILE = join(process.cwd(), "docs/guided-correction/holdout3-first-pass.json");
const scored = runCorpus(HOLDOUT3);
const record = {
  evaluatorVersion: "1.0.0",
  note: "First-pass result on a set written after the evaluator was frozen. No tuning followed.",
  summary: summarize(scored),
  perCase: scored.map((s) => ({ item: s.case.item, source: s.case.source, text: s.case.text, expected: s.case.expect, expectedCategory: s.case.category ?? null, got: s.got.verdict, gotCategory: s.got.category ?? null, reasons: s.got.reasons })),
};

describe("evaluator · unseen corpus 3 (first-pass record)", () => {
  it("records the first pass once, then guards that the frozen evaluator still reproduces it", () => {
    if (!existsSync(FILE)) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(record, null, 2) + "\n");
    }
    const recorded = JSON.parse(readFileSync(FILE, "utf8"));
    expect(record.perCase).toEqual(recorded.perCase);
  });
});
