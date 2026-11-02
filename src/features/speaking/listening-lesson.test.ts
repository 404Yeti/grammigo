import { afterEach, expect, it, vi } from "vitest";
import { evaluateAnswer } from "@/features/practice/grading";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("appends one listening check to every regular lesson without changing earlier questions", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_LISTENING", "");
  const before = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!;
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_LESSON_LISTENING", "true");
  const after = (await import("@/data/lessons")).getLesson(before.id)!;
  const { listLessons } = await import("@/data/lessons");
  expect(after.questions.slice(0, 8)).toEqual(before.questions);
  for (const lesson of listLessons()) {
    expect(lesson.questions).toHaveLength(9);
    const checks = lesson.questions.filter(q => q.listening);
    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe("q9-listening");
    expect(checks[0].options).toHaveLength(4);
    for (const option of checks[0].options!) {
      expect(evaluateAnswer(checks[0], option.id).verdict).toBe(checks[0].acceptedAnswers.includes(option.id) ? "correct" : "incorrect");
    }
  }
});
it("allows reviewed speech in the last construction item and keeps its ordered-word grammar rules", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_SPEAKING", "true");
  const lesson = (await import("@/data/lessons")).getLesson("present-perfect-vs-past-simple")!;
  const q = lesson.questions.findLast(q => q.type === "sentence-construction")!;
  expect(q.allowSpeaking).toBe(true);
  expect(evaluateAnswer(q, "They have lived here since 2018.").verdict).toBe("correct");
  expect(evaluateAnswer(q, "They has lived here since 2018.").verdict).toBe("incorrect");
});

it("upgrades unfinished eight-question attempts once, preserving their answers, draft and cursor", async () => {
  vi.stubEnv("NEXT_PUBLIC_LESSON_LISTENING", "true");
  const lesson = (await import("@/data/lessons")).getLesson("a1-be-present")!;
  const { createSession, ensureListeningQuestion } = await import("@/features/practice/session");
  const session = { ...createSession({ ...lesson, questions: lesson.questions.slice(0, 8) }, "old", 1), currentIndex: 6, draft: "saved draft" };
  const upgraded = ensureListeningQuestion(session, lesson, 2);
  expect(upgraded.records.slice(0, 8)).toEqual(session.records);
  expect(upgraded.records).toHaveLength(9);
  expect(upgraded.currentIndex).toBe(6);
  expect(upgraded.draft).toBe("saved draft");
  expect(ensureListeningQuestion(upgraded, lesson, 3)).toBe(upgraded);
  const completed = { ...session, status: "completed" as const };
  expect(ensureListeningQuestion(completed, lesson, 3)).toBe(completed);
});
