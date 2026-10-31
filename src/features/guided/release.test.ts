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

  it("every authored item is flagged for educator review, and nothing has been signed off", () => {
    for (const i of GUIDED_PILOT.items) expect(i.contentStatus).toBe("needs-educator-review");
    expect(Object.values(VALIDATION_SIGNOFF).every((v) => v === false)).toBe(true);
    expect(EVALUATOR_VERSION).toBe("1.0.0");
  });
});
