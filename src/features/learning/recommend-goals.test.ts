import { describe, expect, it } from "vitest";
import { listSkills, requireSkill } from "@/curriculum";
import { computeAllMastery, type EvidenceEvent } from "./mastery";
import { buildProfile } from "./profile";
import { recommendLessons, type Recommendation } from "./recommend";

const skills = listSkills();
const ids = skills.map((s) => s.id);
const NOW = 1_800_000_000_000;

type Outcome = EvidenceEvent["outcome"];

/** `n` answers on one skill. Lesson answers weigh 1 each, diagnostic answers 0.5 each. */
function answers(skillId: string, outcome: Outcome, n: number, source: EvidenceEvent["source"] = "lesson"): EvidenceEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    skillId,
    outcome,
    source,
    groupId: `${source}-${skillId}-${i % 2}`,
    questionKey: `${skillId}/q${i + 1}`,
    at: NOW - 1000 * (n - i),
  }));
}

function recommend(events: EvidenceEvent[], goalSkillIds: string[]) {
  const mastery = computeAllMastery(ids, events, NOW);
  return { mastery, recs: recommendLessons({ skills, mastery, goalSkillIds, now: NOW }) };
}

const first = (recs: Recommendation[]) => recs[0];
const rank = (recs: Recommendation[], skillId: string) => recs.findIndex((r) => r.skillId === skillId);
const title = (id: string) => requireSkill(id).title;

describe("a stated goal sets the direction", () => {
  it("articles goal + a single unrelated be-present miss in the quick check → articles first (the reported bug)", () => {
    const events = [...answers("a1-articles", "correct_first_try", 1, "diagnostic"), ...answers("a1-be-present", "incorrect", 1, "diagnostic")];
    const { mastery, recs } = recommend(events, ["a1-articles"]);

    expect(first(recs)).toMatchObject({ skillId: "a1-articles", kind: "goal" });
    // be-present is still recommended, just after the goal, as supporting practice
    expect(rank(recs, "a1-be-present")).toBeGreaterThan(0);
    // and nothing about "Present simple: routines" is dangled in front of an articles learner
    expect(first(recs).reason).not.toMatch(/Present simple/);
    // evidence is untouched: the miss is still recorded as an early-read weakness
    expect(mastery.get("a1-be-present")).toMatchObject({ status: "needs_practice", provisional: true, confidence: "insufficient" });
  });

  it("articles goal + several unrelated, well-evidenced weak skills → articles still first", () => {
    const events = [
      ...answers("a2-prepositions-time", "incorrect", 5),
      ...answers("a2-comparatives", "incorrect", 5),
      ...answers("a2-past-simple", "incorrect", 5),
      ...answers("a1-be-present", "incorrect", 4),
    ];
    const { recs } = recommend(events, ["a1-articles"]);
    expect(first(recs)).toMatchObject({ skillId: "a1-articles", kind: "goal" });
    // the unrelated weaknesses are not lost: they follow the goal
    for (const id of ["a2-prepositions-time", "a2-past-simple", "a1-be-present"]) expect(rank(recs, id)).toBeGreaterThan(0);
    // comparatives depends on the weak be-present, so it is held back until be-present is firmed up
    expect(rank(recs, "a2-comparatives")).toBe(-1);
  });

  it("never creates remediation for an unrelated lesson when the learner has goals", () => {
    const events = [...answers("a1-be-present", "incorrect", 5), ...answers("a1-present-simple", "incorrect", 5)];
    const { recs } = recommend(events, ["a1-articles"]);
    expect(recs.filter((r) => r.kind === "remediation")).toHaveLength(0);
  });
});

describe("genuine prerequisites of the goal still come first", () => {
  const goal = "b2-second-third-conditionals";

  it("conditionals goal + well-evidenced weak first conditional → first conditional first, with an accurate reason", () => {
    const { recs } = recommend(answers("b1-first-conditional", "incorrect", 4), [goal]);
    const top = first(recs);
    expect(top).toMatchObject({ skillId: "b1-first-conditional", kind: "remediation", forSkillId: goal });
    expect(top.reason).toContain(`“${title(goal)}”`);
    expect(top.reason).toContain(`“${title("b1-first-conditional")}”`);
    expect(top.reason).toMatch(/building blocks?/);
    expect(top.reason).toContain("4 of 4 answers");
    expect(top.reason).toMatch(/then we go straight to it/);
  });

  it("conditionals goal + the weak prerequisite is NOT in the goal's chain → goal is not blocked", () => {
    const { recs } = recommend(answers("a2-comparatives", "incorrect", 5), [goal]);
    expect(first(recs)).toMatchObject({ skillId: goal });
  });

  it("conditionals goal + a well-evidenced weak deeper prerequisite follows the chain down", () => {
    // present simple is weak; first conditional (its dependent in the chain) has no evidence of its own
    const { recs } = recommend(answers("a1-present-simple", "incorrect", 4), [goal]);
    // the goal's direct prerequisites are first-conditional, past-simple and past-perfect; none is itself weak,
    // so present simple only matters through first-conditional, whose readiness is "unknown" → goal stays accessible
    expect(first(recs).skillId).toBe(goal);
  });
});

describe("insufficient evidence does not block a goal", () => {
  const goal = "b2-second-third-conditionals";

  it("a single early-read miss on the prerequisite → goal first, with an honest note about the early read", () => {
    const { mastery, recs } = recommend(answers("b1-first-conditional", "incorrect", 1, "diagnostic"), [goal]);
    const top = first(recs);
    expect(top).toMatchObject({ skillId: goal, kind: "goal" });
    expect(top.reason).toContain(`“${title("b1-first-conditional")}”`);
    expect(top.reason).toMatch(/very little evidence/);
    expect(top.reason).toMatch(/start right here/);
    // supporting practice stays reachable right after the goal
    expect(rank(recs, "b1-first-conditional")).toBe(1);
    expect(mastery.get("b1-first-conditional")?.status).toBe("needs_practice");
  });

  it("the same single miss with NO stated goals keeps today's behaviour (remediation first)", () => {
    const { recs } = recommend(answers("b1-first-conditional", "incorrect", 1, "diagnostic"), []);
    expect(first(recs)).toMatchObject({ skillId: "b1-first-conditional" });
  });
});

describe("several stated goals", () => {
  it("follow the order the learner stated them, not catalog order", () => {
    // catalog order has articles (A1) before prepositions (A2)
    expect(first(recommend([], ["a2-prepositions-time", "a1-articles"]).recs).skillId).toBe("a2-prepositions-time");
    expect(first(recommend([], ["a1-articles", "a2-prepositions-time"]).recs).skillId).toBe("a1-articles");
  });

  it("a later goal's genuine prerequisite does not jump ahead of an earlier goal", () => {
    const events = [...answers("a1-articles", "correct_first_try", 1, "diagnostic"), ...answers("b1-first-conditional", "incorrect", 4)];
    const { recs } = recommend(events, ["a1-articles", "b2-second-third-conditionals"]);
    expect(recs.slice(0, 2).map((r) => r.skillId)).toEqual(["a1-articles", "b1-first-conditional"]);
    expect(recs[1].kind).toBe("remediation");
  });

  it("…and goes first when its goal was stated first", () => {
    const events = answers("b1-first-conditional", "incorrect", 4);
    const { recs } = recommend(events, ["b2-second-third-conditionals", "a1-articles"]);
    expect(recs.slice(0, 2).map((r) => r.skillId)).toEqual(["b1-first-conditional", "a1-articles"]);
  });

  it("a mastered goal is skipped and the next stated goal leads", () => {
    const events = [...answers("a1-articles", "correct_first_try", 14)];
    // strong needs several sittings; the helper uses two groups per skill
    const { recs } = recommend(events, ["a1-articles", "a2-quantifiers"]);
    expect(first(recs).skillId).not.toBe("a1-articles");
  });
});

/** One lesson sitting: `outcomes` are the 8 answers, in order. */
function sitting(skillId: string, outcomes: Outcome[], n: number): EvidenceEvent[] {
  return outcomes.map((outcome, i) => ({
    skillId,
    outcome,
    source: "lesson" as const,
    groupId: `sitting-${n}-${skillId}`,
    questionKey: `${skillId}/q${i + 1}`,
    at: NOW - 100_000 + n * 10_000 + i,
  }));
}
const C: Outcome = "correct_first_try";
const H: Outcome = "correct_after_hint";
const X: Outcome = "incorrect";

describe("a goal stops dominating once it has been genuinely established (no looping on one lesson)", () => {
  const unrelatedWeakness = answers("a2-prepositions-time", "incorrect", 6);

  it("after one decent goal lesson, a well-evidenced unrelated weakness takes over and the goal follows", () => {
    const events = [...sitting("a1-articles", [C, C, C, C, C, C, C, X], 1), ...unrelatedWeakness];
    const { mastery, recs } = recommend(events, ["a1-articles"]);
    expect(mastery.get("a1-articles")?.status).toBe("developing");
    expect(first(recs)).toMatchObject({ skillId: "a2-prepositions-time", kind: "weak" });
    expect(rank(recs, "a1-articles")).toBeGreaterThan(0); // still reachable
  });

  it("even three ~75% sittings do not trap the learner on the goal lesson", () => {
    const events = [
      ...sitting("a1-articles", [C, C, C, H, C, X, C, H], 1),
      ...sitting("a1-articles", [C, H, C, C, X, C, C, H], 2),
      ...sitting("a1-articles", [C, C, H, C, C, X, H, C], 3),
      ...unrelatedWeakness,
    ];
    expect(first(recommend(events, ["a1-articles"]).recs).skillId).toBe("a2-prepositions-time");
  });

  it("a goal that is still shaky after a lesson (not yet developing) stays first", () => {
    const events = [...sitting("a1-articles", [C, C, C, H, H, H, X, X], 1), ...unrelatedWeakness];
    const { mastery, recs } = recommend(events, ["a1-articles"]);
    expect(mastery.get("a1-articles")?.status).toBe("learning");
    expect(first(recs)).toMatchObject({ skillId: "a1-articles" });
  });

  it("a mastered goal behaves exactly like having no goals", () => {
    const events = [
      ...sitting("a1-articles", [C, C, C, C, C, C, C, C], 1),
      ...sitting("a1-articles", [C, C, C, C, C, C, C, C], 2),
      ...answers("a1-be-present", "incorrect", 4),
    ];
    const withMasteredGoal = recommend(events, ["a1-articles"]).recs.map((r) => [r.skillId, r.kind]);
    const withoutGoals = recommend(events, []).recs.map((r) => [r.skillId, r.kind]);
    expect(withMasteredGoal).toEqual(withoutGoals);
    expect(withMasteredGoal[0]).toEqual(["a1-be-present", "remediation"]); // general remediation is back
  });

  it("with two goals, the finished one steps aside and the other leads", () => {
    const events = [...sitting("a1-articles", [C, C, C, C, C, C, C, X], 1), ...answers("a2-comparatives", "incorrect", 5)];
    const { recs } = recommend(events, ["a1-articles", "a2-prepositions-time"]);
    expect(first(recs)).toMatchObject({ skillId: "a2-prepositions-time", kind: "goal" });
  });
});

describe("no stated goals: behaviour is preserved", () => {
  it("a weak prerequisite still produces remediation for the lesson that depends on it", () => {
    const { recs } = recommend(answers("a1-be-present", "incorrect", 1, "diagnostic"), []);
    const top = first(recs);
    expect(top).toMatchObject({ skillId: "a1-be-present", kind: "remediation" });
    // the original wording, unchanged
    expect(top.reason).toMatch(/^Before “.+”, it helps to firm up “.+”\. You had trouble with it/);
  });

  it("a cold start recommends a friendly A1 foundation", () => {
    const top = first(recommend([], []).recs);
    expect(requireSkill(top.skillId).cefr).toBe("A1");
    expect(top.reason).toMatch(/don’t have any evidence/);
  });

  it("scores stay in the original range (no goal tier is applied)", () => {
    const { recs } = recommend(answers("a2-past-simple", "incorrect", 4), []);
    expect(Math.max(...recs.map((r) => r.score))).toBeLessThan(200);
  });
});

describe("explanations describe the lesson actually selected", () => {
  it("a goal lesson says the learner asked for it; a weak goal says so too", () => {
    const thin = first(recommend([], ["a1-articles"]).recs);
    expect(thin.reason).toContain("You told Migo you want to improve this area");
    expect(thin.reason).toContain(`“${title("a1-articles")}”`);

    const weakGoal = first(recommend(answers("a1-articles", "incorrect", 4), ["a1-articles"]).recs);
    expect(weakGoal).toMatchObject({ skillId: "a1-articles", kind: "weak" });
    expect(weakGoal.reason).toMatch(/^You asked to work on “Articles: a, an, the”/);
    expect(weakGoal.reason).toContain("4 missed");
  });

  it("every reason names the lesson it recommends (or, for remediation, the lesson it unblocks)", () => {
    const scenarios: [EvidenceEvent[], string[]][] = [
      [answers("a1-be-present", "incorrect", 1, "diagnostic"), ["a1-articles"]],
      [answers("b1-first-conditional", "incorrect", 4), ["b2-second-third-conditionals"]],
      [answers("b1-first-conditional", "incorrect", 1, "diagnostic"), ["b2-second-third-conditionals"]],
      [[], ["a2-prepositions-time", "a1-articles"]],
    ];
    for (const [events, goals] of scenarios) {
      const top = first(recommend(events, goals).recs);
      expect(top.reason).toContain(`“${title(top.skillId)}”`);
      if (top.kind === "remediation") expect(top.reason).toContain(`“${title(top.forSkillId!)}”`);
    }
  });
});

describe("this is a recommendation change, not a grading change", () => {
  it("mastery and the profile are identical whether or not the learner has goals", () => {
    const events = [...answers("a1-articles", "correct_first_try", 1, "diagnostic"), ...answers("a1-be-present", "incorrect", 1, "diagnostic")];
    const withGoal = recommend(events, ["a1-articles"]);
    const without = recommend(events, []);
    expect([...withGoal.mastery.entries()]).toEqual([...without.mastery.entries()]);

    const profile = buildProfile({ skills, mastery: withGoal.mastery, goalSkillIds: ["a1-articles"], now: NOW });
    expect(profile.weaknesses.map((w) => w.skillId)).toContain("a1-be-present");
  });
});
