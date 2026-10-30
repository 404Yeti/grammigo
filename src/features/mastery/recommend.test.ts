import { describe, expect, it } from "vitest";
import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import { getSkill } from "@/data/grammar/skills";
import { collectEvidence } from "./evidence";
import { recommendNext } from "./recommend";
import { createSession } from "@/features/practice/session";
import type { Session } from "@/types/session";

function sessionWith(results: ("correct_first_try" | "correct_after_hint" | "correct_after_retry" | "incorrect")[]): Session {
  const base = createSession(lesson, "s", 0);
  return {
    ...base,
    status: "completed",
    records: base.records.map((r, i) => ({
      ...r,
      resolution: results[i] === "incorrect" ? "exhausted" : "correct",
      classification: results[i],
      finalAnswer: "x",
    })),
  };
}

describe("recommendNext", () => {
  const title = (id: string) => getSkill(id).title;

  it("recommends the skill with the most missed or assisted answers", () => {
    const s = sessionWith([
      "correct_first_try", "correct_first_try", "correct_first_try",
      "correct_after_retry", "correct_first_try", "correct_after_hint",
      "correct_first_try", "correct_first_try",
    ]);
    const rec = recommendNext(collectEvidence(s, lesson), lesson, title);
    expect(rec.kind).toBe("practice");
    expect(rec.skillId).toBe("past-simple-finished-time");
    expect(rec.reason).toMatch(/past simple with finished time/i);
  });

  it("weighs a missed answer above an assisted one", () => {
    const s = sessionWith([
      "correct_after_hint", "correct_first_try", "incorrect",
      "correct_first_try", "correct_first_try", "correct_first_try",
      "correct_first_try", "correct_first_try",
    ]);
    const rec = recommendNext(collectEvidence(s, lesson), lesson, title);
    expect(rec.skillId).toBe("present-perfect-since-for");
  });

  it("never treats a clean run as mastery", () => {
    const s = sessionWith(Array(8).fill("correct_first_try"));
    const rec = recommendNext(collectEvidence(s, lesson), lesson, title);
    expect(rec.kind).toBe("consolidate");
    expect(rec.reason).toMatch(/not proof of mastery/);
  });

  it("records independent evidence by kind", () => {
    const s = sessionWith(Array(8).fill("correct_first_try"));
    const ev = collectEvidence(s, lesson);
    const total = ev.reduce((n, e) => n + e.independentByKind.recognition + e.independentByKind.construction + e.independentByKind.production, 0);
    expect(total).toBe(8);
  });
});
