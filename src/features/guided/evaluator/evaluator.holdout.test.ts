import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLDOUT } from "./corpus/holdout";
import { runCorpus, summarize } from "./score";

const scored = runCorpus(HOLDOUT);
const s = summarize(scored);

/** Held-out set 1. Its first run found real rule holes (recorded in the Phase 1 report); it is now a regression set. */
describe("evaluator · held-out corpus 1 (regression set)", () => {
  it("writes the full summary for the report", () => {
    mkdirSync("/tmp/claude-1000/guided", { recursive: true });
    writeFileSync("/tmp/claude-1000/guided/holdout-summary.json", JSON.stringify(s, null, 2));
    expect(s.totals.cases).toBeGreaterThanOrEqual(80);
  });

  it("never says 'incorrect' to a valid or ambiguous answer (false-wrong = 0)", () => {
    expect(s.falseWrong.list).toEqual([]);
  });

  it("never mislabels the category of a detected error", () => {
    expect(s.errors.wrongCategoryList).toEqual([]);
  });

  it("never accepts a clear target error as correct", () => {
    expect(s.errors.acceptedList).toEqual([]);
  });

  it("detects at least 90% of clear target errors and recognises at least 90% of valid answers", () => {
    expect(s.errors.recall).toBeGreaterThanOrEqual(0.9);
    expect(s.valid.recognisedRate).toBeGreaterThanOrEqual(0.9);
  });
});
