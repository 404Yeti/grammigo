import { afterEach, expect, it, vi } from "vitest";
import { evaluateAnswer } from "@/features/practice/grading";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("adds listening without changing IDs, choices, grading or existing progress keys", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_LISTENING", "");
  const before = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!;
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_LESSON_LISTENING", "true");
  const after = (await import("@/data/lessons")).getLesson(before.id)!;
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  const listening = after.questions[0];
  expect(listening.listening?.transcript).toContain("been there twice");
  expect(listening.options).toEqual(before.questions[0].options);
  expect(listening.acceptedAnswers).toEqual(before.questions[0].acceptedAnswers);
  expect(evaluateAnswer(listening, "b").verdict).toBe("correct");
  expect(evaluateAnswer(listening, "a").verdict).toBe("incorrect");
});
it("allows reviewed speech in the last construction item and keeps its ordered-word grammar rules", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_SPEAKING", "true");
  const lesson = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!;
  const q = lesson.questions.findLast(q => q.type === "sentence-construction")!;
  expect(q.allowSpeaking).toBe(true);
  expect(evaluateAnswer(q, "They have lived here since 2018.").verdict).toBe("correct");
  expect(evaluateAnswer(q, "They has lived here since 2018.").verdict).toBe("incorrect");
});
