import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEV } from "./corpus/dev";
import { runCorpus, summarize } from "./score";

const scored = runCorpus(DEV);
const s = summarize(scored);

describe("evaluator · DEV corpus", () => {
  it("writes the full summary for the report", () => {
    mkdirSync("/tmp/claude-1000/guided", { recursive: true });
    writeFileSync("/tmp/claude-1000/guided/dev-summary.json", JSON.stringify(s, null, 2));
    expect(s.totals.cases).toBeGreaterThanOrEqual(150);
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

  it("detects at least 90% of clear target errors; the rest fall to uncertain", () => {
    expect(s.errors.recall).toBeGreaterThanOrEqual(0.9);
  });

  it("recognises natural valid answers (the rest are uncertain, never wrong)", () => {
    expect(s.valid.missedList).toEqual([]);
  });

  it("ignores unrelated mistakes (spelling, articles, prepositions, regularised verbs)", () => {
    expect(s.unrelatedErrors.ignored).toBe(s.unrelatedErrors.cases);
  });
});
