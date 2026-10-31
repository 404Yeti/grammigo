import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDED_PILOT } from "@/curriculum/guided";
import { EVALUATOR_VERSION, VALIDATION_SIGNOFF, guidedReleaseStatus } from "./release";

describe("release gate: provisional until an educator has validated it", () => {
  it("is NOT releasable, and says exactly why", () => {
    const status = guidedReleaseStatus();
    expect(status.releasable).toBe(false);
    expect(status.blockers.map((b) => b.id).sort()).toEqual(["educator-review-content", "educator-review-labels", "outcome-weights-unvalidated", "real-device-testing-pending", "unseen-validation-pending"]);
    for (const b of status.blockers) expect(b.detail.length).toBeGreaterThan(20);
  });

  it("keeps the unseen-set failures visible as open educator-review items, exactly as recorded", () => {
    const items = guidedReleaseStatus().reviewItems;
    expect(items.filter((i) => i.set === "3").map((i) => [i.kind, i.status, i.sentence])).toEqual([
      ["incorrectly_accepted", "addressed_in_1.1.0", "I have learned English for I was a child."],
      ["wrong_category", "open", "I learn English since four years."],
      ["wrong_category", "open", "I have began to learn English two years ago."],
      ["missed_error", "addressed_in_1.1.0", "I study English since I was twelve."],
    ]);
    // the two multi-error ordering questions are NOT silently relabelled: they stay open for the educator
    expect(items.filter((i) => i.kind === "wrong_category").every((i) => i.status === "open")).toBe(true);
  });

  it("set-4 findings are recorded from the first pass, nothing tuned", () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), "docs/guided-correction/holdout4-first-pass.json"), "utf8")).perCase as { text: string; got: string; gotCategory: string | null; expected: string; expectedCategory: string | null }[];
    const wrong = recorded.filter((c) => (c.expected === "incorrect" && (c.got !== "incorrect" || c.gotCategory !== c.expectedCategory)) || (c.expected === "correct" && c.got !== "correct")).map((c) => c.text);
    expect(guidedReleaseStatus().reviewItems.filter((i) => i.set === "4").map((i) => i.sentence).sort()).toEqual([...wrong].sort());
  });

  it("the set-3 review items match what the recorded 1.0.0 first pass actually says (nothing was edited afterwards)", () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), "docs/guided-correction/holdout3-first-pass.json"), "utf8")).perCase as { text: string; got: string; gotCategory: string | null; expected: string; expectedCategory: string | null }[];
    const bad = recorded.filter((c) => c.expected === "incorrect" && (c.got !== "incorrect" || c.gotCategory !== c.expectedCategory)).map((c) => c.text);
    expect(guidedReleaseStatus().reviewItems.filter((i) => i.set === "3").map((i) => i.sentence).sort()).toEqual([...bad].sort());
    expect(recorded.find((c) => c.text === "I have learned English for I was a child.")?.got).toBe("correct");
  });

  it("every authored item is flagged for educator review, and nothing has been signed off", () => {
    for (const i of GUIDED_PILOT.items) expect(i.contentStatus).toBe("needs-educator-review");
    expect(Object.values(VALIDATION_SIGNOFF).every((v) => v === false)).toBe(true);
    expect(EVALUATOR_VERSION).toBe("1.1.0");
  });
});
