import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GuidedOutcomeKind, GuidedState } from "@/types/guided";
import { countOutcomes, hasActivity } from "./outcome-counts";

const exercise = (kind: GuidedOutcomeKind | null) => ({ outcome: kind ? { kind, basis: "deterministic", source: "typed", at: 1 } : null });
const state = (kinds: (GuidedOutcomeKind | null)[][]): GuidedState => ({ version: 1, activeSessionId: null, sessions: kinds.map((ks) => ({ exercises: ks.map(exercise) })) }) as unknown as GuidedState;

describe("guided outcome counts", () => {
  it("counts how exercises ended, across sessions, and ignores unfinished ones", () => {
    const c = countOutcomes(state([["first_try", "self_corrected", null], ["first_try", "shown", "hint_assisted", "unverified"]]));
    expect(c).toEqual({ first_try: 2, self_corrected: 1, hint_assisted: 1, shown: 1, unverified: 1 });
    expect(hasActivity(c)).toBe(true);
  });
  it("is empty for no history", () => {
    expect(hasActivity(countOutcomes(state([])))).toBe(false);
    expect(hasActivity(countOutcomes(state([[null]])))).toBe(false);
  });
  it("is only ever counts: the module has no weights, scores or percentages", () => {
    const src = readFileSync(join(process.cwd(), "src/features/guided/store/outcome-counts.ts"), "utf8");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/GUIDED_OUTCOME_VALUES|outcomeValue|summarizeOutcomes|meanProvisionalValue|\*\s*100|Math\.round|toFixed/);
  });
});
