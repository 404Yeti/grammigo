import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOLDOUT4 } from "./corpus/holdout4";
import { runCorpus, summarize } from "./score";

/**
 * UNSEEN set 4 (written after evaluator 1.1.0 was frozen). The FIRST run is recorded verbatim in
 * docs/guided-correction/holdout4-first-pass.json and reported as-is. This test asserts NO accuracy thresholds
 * (that would invite tuning); afterwards it only checks that the frozen evaluator still reproduces the record.
 * Once the evaluator changes, this set is "seen" and a new one must be written.
 */
const FILE = join(process.cwd(), "docs/guided-correction/holdout4-first-pass.json");
const scored = runCorpus(HOLDOUT4);
const record = {
  evaluatorVersion: "1.1.0",
  note: "First-pass result on a set written after the 1.1.0 freeze. No tuning followed.",
  summary: summarize(scored),
  perCase: scored.map((s) => ({ item: s.case.item, source: s.case.source, text: s.case.text, expected: s.case.expect, expectedCategory: s.case.category ?? null, got: s.got.verdict, gotCategory: s.got.category ?? null, reasons: s.got.reasons })),
};

describe("evaluator · unseen corpus 4 (first-pass record)", () => {
  it("records the first pass once, then guards that the frozen evaluator still reproduces it", () => {
    if (!existsSync(FILE)) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(record, null, 2) + "\n");
    }
    const recorded = JSON.parse(readFileSync(FILE, "utf8"));
    expect(record.perCase).toEqual(recorded.perCase);
  });
});
