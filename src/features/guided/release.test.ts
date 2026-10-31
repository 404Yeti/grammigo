import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDED_PILOT } from "@/curriculum/guided";
import { EVALUATOR_VERSION, VALIDATION_SIGNOFF, guidedReleaseStatus } from "./release";

describe("release gate: provisional until an educator has validated it", () => {
  it("is NOT releasable, and says exactly why", () => {
    const status = guidedReleaseStatus();
    expect(status.releasable).toBe(false);
    expect(status.blockers.map((b) => b.id).sort()).toEqual(["educator-review-content", "educator-review-labels", "outcome-weights-unvalidated", "unseen-validation-pending"]);
    for (const b of status.blockers) expect(b.detail.length).toBeGreaterThan(20);
  });

  it("keeps the unseen-set failures visible as open educator-review items, exactly as recorded", () => {
    const items = guidedReleaseStatus().reviewItems;
    expect(items.map((i) => [i.kind, i.sentence])).toEqual([
      ["incorrectly_accepted", "I have learned English for I was a child."],
      ["wrong_category", "I learn English since four years."],
      ["wrong_category", "I have began to learn English two years ago."],
      ["missed_error", "I study English since I was twelve."],
    ]);
  });

  it("the review items match what the recorded first pass actually says (nothing was edited afterwards)", () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), "docs/guided-correction/holdout3-first-pass.json"), "utf8")).perCase as { text: string; got: string; gotCategory: string | null; expected: string; expectedCategory: string | null }[];
    const byText = new Map(recorded.map((c) => [c.text, c]));
    const bad = recorded.filter((c) => c.expected === "incorrect" && (c.got !== "incorrect" || c.gotCategory !== c.expectedCategory)).map((c) => c.text);
    expect(guidedReleaseStatus().reviewItems.map((i) => i.sentence).sort()).toEqual([...bad].sort());
    expect(byText.get("I have learned English for I was a child.")?.got).toBe("correct");
  });

  it("every authored item is flagged for educator review, and nothing has been signed off", () => {
    for (const i of GUIDED_PILOT.items) expect(i.contentStatus).toBe("needs-educator-review");
    expect(Object.values(VALIDATION_SIGNOFF).every((v) => v === false)).toBe(true);
    expect(EVALUATOR_VERSION).toBe("1.0.0");
  });
});
