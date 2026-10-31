import { describe, expect, it } from "vitest";
import { evaluate } from "@/features/guided/evaluator";
import { WRONG_PARTICIPLE } from "@/features/guided/evaluator/lexicon";
import { TARGET_CATEGORIES } from "@/features/guided/evaluator/types";
import { GUIDED_PILOT, getGuidedCategory, getGuidedItem, renderLadder } from "./index";

const asEvaluatorItem = (id: string) => {
  const i = getGuidedItem(id)!;
  return { id: i.id, frame: i.frame, categories: i.categories };
};

describe("guided pilot content: structure", () => {
  it("validates against its schema, is flagged for educator review, and is about the right skill", () => {
    expect(GUIDED_PILOT.skillId).toBe("present-perfect-vs-past-simple");
    for (const i of GUIDED_PILOT.items) expect(i.contentStatus).toBe("needs-educator-review");
  });

  it("has one main item and transfers for both directions plus an alternate", () => {
    expect(GUIDED_PILOT.items.filter((i) => i.kind === "main")).toHaveLength(1);
    for (const id of [...GUIDED_PILOT.transferPlan.afterError, ...GUIDED_PILOT.transferPlan.afterFirstTry, ...GUIDED_PILOT.transferPlan.alternate]) {
      expect(getGuidedItem(id)?.kind).toBe("transfer");
    }
    const frames = (ids: string[]) => ids.map((id) => getGuidedItem(id)!.frame);
    expect(frames(GUIDED_PILOT.transferPlan.afterError)).toContain("finished"); // same direction as the main item
    expect(frames(GUIDED_PILOT.transferPlan.afterFirstTry)).toContain("unfinished"); // the opposite direction
  });

  it("every category an item uses has an authored ladder", () => {
    for (const i of GUIDED_PILOT.items) for (const c of i.categories) expect(getGuidedCategory(c), `${i.id}:${c}`).toBeDefined();
    for (const c of TARGET_CATEGORIES) expect(getGuidedCategory(c)).toBeDefined();
  });

  it("questions are conversational: real questions, spoken form present, nobody is asked to write a mistake", () => {
    for (const i of GUIDED_PILOT.items) {
      expect(i.question.trim().endsWith("?"), i.id).toBe(true);
      expect(i.speakable.length).toBeGreaterThanOrEqual(i.question.length - 1);
      const everything = `${i.situation} ${i.question} ${i.answerHint}`.toLowerCase();
      expect(everything, i.id).not.toMatch(/mistake|wrong|incorrect|correct the|find the error|rewrite/);
    }
  });
});

describe("guided pilot content: stays in step with the evaluator", () => {
  it("every model answer is judged correct for its own item (typed and spoken)", () => {
    for (const i of GUIDED_PILOT.items) {
      for (const a of i.modelAnswers) {
        for (const source of ["typed", "spoken"] as const) {
          expect(evaluate(asEvaluatorItem(i.id), { text: a, source }).verdict, `${i.id}: ${a}`).toBe("correct");
        }
      }
    }
  });

  it("every sample mistake is judged as exactly that category", () => {
    for (const i of GUIDED_PILOT.items) {
      for (const [category, samples] of Object.entries(i.wrongSamples)) {
        expect(i.categories, `${i.id} lists ${category}`).toContain(category);
        for (const text of samples ?? []) {
          const e = evaluate(asEvaluatorItem(i.id), { text, source: "typed" });
          expect([e.verdict, e.category], `${i.id}: ${text}`).toEqual(["incorrect", category]);
        }
      }
    }
  });

  it("every category an item allows has at least one sample mistake", () => {
    for (const i of GUIDED_PILOT.items) for (const c of i.categories) expect(i.wrongSamples[c]?.length ?? 0, `${i.id}:${c}`).toBeGreaterThan(0);
  });
});

describe("guided pilot content: the hint ladder", () => {
  const ctxFor = (c: string) =>
    c === "participle_form" ? { aux: "have", verb: "went" } : c === "pp_with_finished_time" ? { marker: "yesterday evening", aux: "have", verb: "watched" } : {};
  const forbiddenInRungs1And2 = [/past simple/i, /present perfect/i, /participle/i];

  it("rungs 1 and 2 never name the target tense or form (they point, they don't tell)", () => {
    for (const c of TARGET_CATEGORIES) {
      const l = renderLadder(c, ctxFor(c));
      for (const rung of [l.notice, l.hint2]) for (const re of forbiddenInRungs1And2) expect(rung, `${c}: ${rung}`).not.toMatch(re);
    }
  });

  it("rungs 1 and 2 never contain any model answer or the participle the learner should use", () => {
    for (const c of TARGET_CATEGORIES) {
      for (const [wrong, fix] of WRONG_PARTICIPLE) {
        const l = renderLadder(c, { aux: "have", verb: wrong, marker: "yesterday" });
        for (const rung of [l.notice, l.hint2]) expect(rung.toLowerCase(), `${c}/${wrong}`).not.toContain(` ${fix} `);
      }
      for (const i of GUIDED_PILOT.items) for (const a of i.modelAnswers) for (const rung of [renderLadder(c, ctxFor(c)).notice, renderLadder(c, ctxFor(c)).hint2]) expect(rung).not.toContain(a);
    }
  });

  it("rung 3 examples never reuse the learner's own verb", () => {
    for (const [wrong] of WRONG_PARTICIPLE) {
      const l = renderLadder("participle_form", { aux: "have", verb: wrong });
      expect(l.hint3.toLowerCase()).not.toMatch(new RegExp(`\\b${wrong}\\b`));
    }
  });

  it("fills in the learner's own words and leaves no placeholder behind, even with nothing detected", () => {
    const l = renderLadder("pp_with_finished_time", { marker: "last summer" });
    expect(l.notice).toContain("“last summer”");
    expect(l.reason).toContain("“last summer”");
    expect(renderLadder("participle_form", { aux: "has", verb: "went" }).notice).toContain("“has”");
    expect(renderLadder("participle_form", { aux: "has", verb: "went" }).reason).toContain("have gone");
    for (const c of TARGET_CATEGORIES) {
      const bare = renderLadder(c);
      for (const text of Object.values(bare)) expect(text, c).not.toMatch(/[{}]/);
    }
  });

  it("every reason is at most two short sentences, and every rung is short enough for a phone", () => {
    for (const c of TARGET_CATEGORIES) {
      const l = renderLadder(c, ctxFor(c));
      expect(l.reason.split(/(?<=[.!?”"])\s+(?=[A-Z“"])/).length, c).toBeLessThanOrEqual(2);
      for (const rung of Object.values(l)) expect(rung.length, `${c}: ${rung}`).toBeLessThanOrEqual(230);
    }
  });

  it("is encouraging and age-neutral: no shaming, no childish praise", () => {
    for (const c of TARGET_CATEGORIES) {
      for (const text of Object.values(renderLadder(c, ctxFor(c)))) expect(text, c).not.toMatch(/wrong|mistake|bad|silly|stupid|kids?|children|baby|great job|awesome|!/i);
    }
  });
});
