import { afterEach, expect, it, vi } from "vitest";
import { evaluateAnswer } from "@/features/practice/grading";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("leaves the beta unchanged by default and preserves session identities when speaking is enabled", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_SPEAKING", "");
  const before = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!;
  expect(before.questions[7].type).toBe("short-writing");
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_LESSON_SPEAKING", "true");
  const after = (await import("@/data/lessons")).getLesson(before.id)!;
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions[7]).toMatchObject({ type: "speaking", strategy: "limited-rubric", evidence: "production" });
  expect(after.questions.slice(0, 7)).toEqual(before.questions.slice(0, 7));
});
it("checks the existing grammar objective locally, and only calls an explicit tense/time clash incorrect", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_SPEAKING", "true");
  const question = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!.questions[7];
  expect(evaluateAnswer(question, "I have visited Paris this week. I watched a film yesterday.").verdict).toBe("correct");
  expect(evaluateAnswer(question, "I have visited Paris yesterday. I watched a film yesterday.")).toMatchObject({ verdict: "incorrect", message: expect.stringContaining("Finished times take the past simple") });
  expect(evaluateAnswer(question, "This has been a lovely week. Yesterday I was feeling a little tired.").verdict).not.toBe("incorrect");
});
