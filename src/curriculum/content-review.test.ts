import { describe, expect, it } from "vitest";
import { getCurriculumSkill, listSkills, requireSkill } from "@/curriculum";
import { answersMatch } from "@/features/practice/normalize";
import { computeAllMastery, type EvidenceEvent } from "@/features/learning/mastery";
import { prerequisiteReadiness, recommendLessons } from "@/features/learning/recommend";
import { buildItemPool } from "@/features/diagnostic/engine";

const skills = listSkills();
const NOW = 1_800_000_000_000;

const evidence = (skillId: string, outcome: EvidenceEvent["outcome"], n: number): EvidenceEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    skillId,
    outcome,
    source: "lesson" as const,
    groupId: `g${i % 2}`,
    questionKey: `${skillId}/q${i + 1}`,
    at: NOW - 1000 * (n - i),
  }));

describe("educator decision 1: reported speech has one defensible answer", () => {
  const reported = requireSkill("b2-reported-speech");

  it("the will/would item anchors a finished moment so 'will' is not also correct", () => {
    const q = reported.questions[2];
    expect(q.type).toBe("multiple-choice-context");
    expect(q.prompt).toMatch(/Ten years ago/);
    expect(q.prompt).toMatch(/doesn’t teach me now/);
    expect(q.acceptedAnswers).toEqual(["a"]);
    expect(q.options?.[0].label).toBe("would");
  });

  it("the present-to-past fill anchors a finished moment so 'lives' is not also correct", () => {
    const q = reported.questions[1];
    expect(q.prompt).toMatch(/doesn’t live there now/);
    expect(answersMatch("lived", q.acceptedAnswers)).toBe(true);
    expect(answersMatch("lives", q.acceptedAnswers)).toBe(false);
  });

  it("accepts the valid 'd contraction in the rewrite", () => {
    const q = reported.questions[6];
    expect(answersMatch("Tom said he'd finished his homework.", q.acceptedAnswers)).toBe(true);
    expect(answersMatch("Tom said he had finished his homework", q.acceptedAnswers)).toBe(true);
    expect(answersMatch("Tom said he has finished his homework", q.acceptedAnswers)).toBe(false);
  });

  it("the writing rubric allows keeping the tense when the statement is still true", () => {
    expect(reported.questions[7].writingCriteria).toMatch(/still true now/);
  });
});

describe("educator decision 2: past perfect comes before third conditionals", () => {
  const pp = requireSkill("b1-past-perfect");
  const cond = requireSkill("b2-second-third-conditionals");

  it("is a complete 8-exercise B1 lesson with a prerequisite and flagged for educator review", () => {
    expect(pp.cefr).toBe("B1");
    expect(pp.questions).toHaveLength(8);
    expect(pp.prerequisites).toEqual(["a2-past-simple"]);
    expect(pp.contentStatus).toBe("needs-educator-review");
    expect(getCurriculumSkill("b1-past-perfect")).toBeDefined();
  });

  it("is a prerequisite of the second/third conditionals", () => {
    expect(cond.prerequisites).toContain("b1-past-perfect");
  });

  it("its closed items have exactly one correct reading", () => {
    const [mc, fill, mcCtx, fix, , verb] = pp.questions;
    expect(mc.acceptedAnswers).toEqual(["a"]);
    expect(mcCtx.acceptedAnswers).toEqual(["b"]);
    expect(mcCtx.options?.[1].label).toBe("had");
    expect(answersMatch("left", fill.acceptedAnswers)).toBe(true);
    expect(answersMatch("had already left", fill.acceptedAnswers)).toBe(true);
    expect(answersMatch("leaved", fill.acceptedAnswers)).toBe(false);
    expect(answersMatch("By the time I arrived, the meeting had already started.", fix.acceptedAnswers)).toBe(true);
    expect(answersMatch("By the time I arrived, the meeting already started.", fix.acceptedAnswers)).toBe(false);
    expect(answersMatch("had left", verb.acceptedAnswers)).toBe(true);
    expect(answersMatch("left", verb.acceptedAnswers)).toBe(false);
  });

  it("the diagnostic can sample the new skill", () => {
    expect(buildItemPool(skills).some((i) => i.skillId === "b1-past-perfect")).toBe(true);
  });

  it("no evidence → not assumed mastered: readiness is 'unknown', not 'ready', but it does not block", () => {
    const mastery = computeAllMastery(skills.map((s) => s.id), [], NOW);
    expect(prerequisiteReadiness(cond, mastery).state).toBe("unknown");
    expect(prerequisiteReadiness(cond, mastery).unknown).toContain("b1-past-perfect");
  });

  it("weak past perfect + goal of conditionals → remediate past perfect first, with an honest reason", () => {
    const events = [
      ...evidence("a1-be-present", "correct_first_try", 4),
      ...evidence("a1-present-simple", "correct_first_try", 4),
      ...evidence("a2-past-simple", "correct_first_try", 4),
      ...evidence("b1-first-conditional", "correct_first_try", 4),
      ...evidence("b1-past-perfect", "incorrect", 4),
    ];
    const mastery = computeAllMastery(skills.map((s) => s.id), events, NOW);
    const [first] = recommendLessons({ skills, mastery, goalSkillIds: ["b2-second-third-conditionals"], now: NOW });
    expect(first.skillId).toBe("b1-past-perfect");
    expect(first.kind).toBe("remediation");
    expect(first.forSkillId).toBe("b2-second-third-conditionals");
    expect(first.reason).toMatch(/Past perfect/);
  });

  it("strong past perfect → conditionals are no longer held back", () => {
    const events = [
      ...evidence("a2-past-simple", "correct_first_try", 8),
      ...evidence("b1-first-conditional", "correct_first_try", 8),
      ...evidence("b1-past-perfect", "correct_first_try", 8),
    ];
    const mastery = computeAllMastery(skills.map((s) => s.id), events, NOW);
    expect(prerequisiteReadiness(cond, mastery).state).toBe("ready");
  });
});
