import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEUTRAL, VOICE_MESSAGES } from "./cycle/messages";
import { CONTRAST, COPY, OUTCOME_LABEL, RESOLVED } from "./ui/copy";

/**
 * The 1.0 / 0.7 / 0.5 / 0 weights are provisional ACTIVITY metrics, separate from mastery. Nothing a learner sees may
 * present them, or the outcome chips, as a score, a level or a proficiency claim, and the screens never read the weights.
 */
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
const WORDING = [COPY, RESOLVED, OUTCOME_LABEL, CONTRAST, NEUTRAL, VOICE_MESSAGES].flatMap(strings);
const CLAIM = /\b(proficien\w*|fluen\w*|fluent|levels?|scores?|scored|grades?|graded|marks?|CEFR|[ABC][12]|master(?:y|ed)?|percent\w*|points?|rank\w*|rating|you are (?:an? )?(?:beginner|intermediate|advanced))\b|%|\d\.\d/i;

describe("no proficiency or score claims from the provisional outcome weights", () => {
  it("learner-facing wording never talks about score, level, mastery, grade or proficiency", () => {
    expect(WORDING.length).toBeGreaterThan(50);
    expect(WORDING.filter((t) => CLAIM.test(t))).toEqual([]);
  });

  it("the summary says the results are kept separate from lesson progress while their meaning is checked", () => {
    expect(COPY.summary.how).toMatch(/kept separate from your lesson progress while we check what they mean/i);
  });

  it("the screens never import or print the weights", () => {
    const dir = join(process.cwd(), "src/features/guided/ui");
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/GUIDED_OUTCOME_VALUES|outcomeValue|summarizeOutcomes|meanProvisionalValue/);
    }
  });
});
