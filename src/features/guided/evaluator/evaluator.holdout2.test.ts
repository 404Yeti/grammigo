import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLDOUT2 } from "./corpus/holdout2";
import { runCorpus, summarize } from "./score";

const s = summarize(runCorpus(HOLDOUT2));

/**
 * Held-out set 2. Its FIRST run (before the fixes it prompted) is the clean estimate in the Phase 1 report.
 * From here on it is a regression set: the invariants below must hold on every run.
 */
describe("evaluator · held-out corpus 2 (regression set)", () => {
  it("writes the full summary for the report", () => {
    mkdirSync("/tmp/claude-1000/guided", { recursive: true });
    writeFileSync("/tmp/claude-1000/guided/holdout2-summary.json", JSON.stringify(s, null, 2));
    expect(s.totals.cases).toBeGreaterThanOrEqual(80);
  });

  it("never says 'incorrect' to a valid or ambiguous answer (false-wrong = 0)", () => {
    expect(s.falseWrong.list).toEqual([]);
  });

  it("never accepts a clear target error as correct, and never mislabels a category", () => {
    expect(s.errors.acceptedList).toEqual([]);
    expect(s.errors.wrongCategoryList).toEqual([]);
  });

  it("detects at least 90% of clear target errors", () => {
    expect(s.errors.recall).toBeGreaterThanOrEqual(0.9);
  });

  it("recognises at least 90% of valid answers; the rest are uncertain, never wrong", () => {
    expect(s.valid.recognisedRate).toBeGreaterThanOrEqual(0.9);
  });
});
