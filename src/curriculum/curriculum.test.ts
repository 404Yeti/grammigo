import { describe, expect, it } from "vitest";
import { CURRICULUM, availableLevels, getCurriculumSkill, listSkills, toLesson } from "./index";
import { CurriculumValidationError, validateCurriculum } from "./validate";
import { evaluateAnswer } from "@/features/practice/grading";
import { DIAGNOSTIC_TYPES } from "./schema";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const base = () => clone(CURRICULUM);
const issuesOf = (raw: unknown): string[] => {
  try {
    validateCurriculum(raw);
  } catch (e) {
    if (e instanceof CurriculumValidationError) return e.issues;
    throw e;
  }
  return [];
};

describe("shipped catalog", () => {
  it("validates and spans A1–B2 with roughly twelve lessons", () => {
    expect(listSkills()).toHaveLength(12);
    expect(availableLevels()).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("keeps the v0.1 lesson id, title and question ids so saved sessions still work", () => {
    const lesson = toLesson(getCurriculumSkill("present-perfect-vs-past-simple")!);
    expect(lesson.title).toBe("Present Perfect vs. Past Simple");
    expect(lesson.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  });

  it("every skill has exactly eight exercises, one of each type, and every closed answer key grades correct", () => {
    for (const skill of listSkills()) {
      expect(skill.questions).toHaveLength(8);
      expect(new Set(skill.questions.map((q) => q.type)).size).toBe(8);
      for (const q of skill.questions) {
        for (const a of q.acceptedAnswers) {
          expect(evaluateAnswer(q, a).verdict, `${skill.id}/${q.id} "${a}"`).toBe("correct");
        }
      }
    }
  });

  it("every skill has at least four diagnostic-eligible closed items spanning two difficulty levels", () => {
    for (const skill of listSkills()) {
      const items = skill.questions.filter((q) => (DIAGNOSTIC_TYPES as readonly string[]).includes(q.type));
      expect(items.length, skill.id).toBeGreaterThanOrEqual(4);
      expect(new Set(items.map((q) => q.difficulty)).size, skill.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("prerequisites never point to a higher CEFR level (levels are metadata, not gates)", () => {
    for (const skill of listSkills()) {
      for (const pre of skill.prerequisites) {
        expect(getCurriculumSkill(pre)!.cefr <= skill.cefr).toBe(true);
      }
    }
  });
});

describe("validateCurriculum", () => {
  it("rejects duplicate skill ids", () => {
    const c = base();
    c.skills[1].id = c.skills[0].id;
    expect(issuesOf(c).join("\n")).toMatch(/duplicate skill id/);
  });

  it("rejects duplicate slugs", () => {
    const c = base();
    c.skills[1].slug = c.skills[0].slug;
    expect(issuesOf(c).join("\n")).toMatch(/duplicate skill slug/);
  });

  it("rejects broken prerequisites", () => {
    const c = base();
    c.skills[2].prerequisites = ["does-not-exist"];
    expect(issuesOf(c).join("\n")).toMatch(/prerequisite "does-not-exist" does not exist/);
  });

  it("rejects prerequisite cycles", () => {
    const c = base();
    const a = c.skills.find((s) => s.id === "a1-articles")!;
    const q = c.skills.find((s) => s.id === "a2-quantifiers")!;
    a.prerequisites = ["a2-quantifiers"];
    q.prerequisites = ["a1-articles"];
    const text = issuesOf(c).join("\n");
    expect(text).toMatch(/prerequisite cycle|higher level/);
  });

  it("rejects a skill that lists itself as a prerequisite", () => {
    const c = base();
    c.skills[0].prerequisites = [c.skills[0].id];
    expect(issuesOf(c).join("\n")).toMatch(/itself/);
  });

  it("rejects a prerequisite from a higher CEFR level", () => {
    const c = base();
    c.skills[0].prerequisites = ["b1-first-conditional"];
    expect(issuesOf(c).join("\n")).toMatch(/higher level/);
  });

  it("rejects missing answer keys", () => {
    const c = base();
    c.skills[0].questions[1].acceptedAnswers = [];
    expect(issuesOf(c).join("\n")).toMatch(/missing answer key/);
  });

  it("rejects a choice answer key that is not an option", () => {
    const c = base();
    c.skills[0].questions[0].acceptedAnswers = ["z"];
    expect(issuesOf(c).join("\n")).toMatch(/not one of the options/);
  });

  it("rejects unsupported exercise types", () => {
    const c = base();
    (c.skills[0].questions[0] as { type: string }).type = "speaking-aloud";
    expect(issuesOf(c).length).toBeGreaterThan(0);
  });

  it("rejects a strategy that does not fit the exercise type", () => {
    const c = base();
    c.skills[0].questions[1].strategy = "exact-choice";
    expect(issuesOf(c).join("\n")).toMatch(/not supported for exercise type/);
  });

  it("rejects construction answers that do not use the tiles", () => {
    const c = base();
    c.skills[0].questions[4].acceptedAnswers = ["My friend is from Italy"];
    expect(issuesOf(c).join("\n")).toMatch(/does not use exactly the tiles/);
  });

  it("rejects lessons without exactly eight exercises", () => {
    const c = base();
    c.skills[0].questions.pop();
    expect(issuesOf(c).length).toBeGreaterThan(0);
  });

  it("rejects the wrong schema version", () => {
    const c = base() as { schemaVersion: number };
    c.schemaVersion = 99;
    expect(issuesOf(c).join("\n")).toMatch(/schemaVersion/);
  });
});
