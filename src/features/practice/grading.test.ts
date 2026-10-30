import { describe, expect, it } from "vitest";
import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import { evaluateAnswer } from "./grading";

const q = (id: string) => lesson.questions.find((x) => x.id === id)!;

describe("evaluateAnswer: closed-ended", () => {
  it("grades multiple choice by option id", () => {
    expect(evaluateAnswer(q("q1"), "b").verdict).toBe("correct");
    expect(evaluateAnswer(q("q1"), "a").verdict).toBe("incorrect");
    expect(evaluateAnswer(q("q3"), "a").verdict).toBe("correct");
  });

  it("treats an empty answer as invalid, not incorrect", () => {
    expect(evaluateAnswer(q("q2"), "  ").verdict).toBe("invalid");
  });

  it("accepts fill-in answers regardless of case and punctuation", () => {
    expect(evaluateAnswer(q("q2"), "Watched.").verdict).toBe("correct");
    expect(evaluateAnswer(q("q2"), "We watched a great film last weekend.").verdict).toBe("correct");
  });

  it("returns a grammar-specific message for known misconceptions", () => {
    const result = evaluateAnswer(q("q6"), "has left");
    expect(result.verdict).toBe("incorrect");
    expect(result.message).toMatch(/finished time/);
  });

  it("accepts every explicitly supported correction and rejects the original sentence", () => {
    expect(evaluateAnswer(q("q4"), "I saw that film yesterday.").verdict).toBe("correct");
    expect(evaluateAnswer(q("q4"), "Yesterday I watched that film").verdict).toBe("correct");
    const same = evaluateAnswer(q("q4"), "I have seen that film yesterday.");
    expect(same.verdict).toBe("incorrect");
    expect(same.message).toMatch(/same sentence/);
  });

  it("grades sentence construction with both valid word orders", () => {
    expect(evaluateAnswer(q("q5"), "They have lived here since 2018").verdict).toBe("correct");
    expect(evaluateAnswer(q("q5"), "Since 2018 they have lived here").verdict).toBe("correct");
    expect(evaluateAnswer(q("q5"), "They lived have here since 2018").verdict).toBe("incorrect");
  });

  it("handles contractions in transformations", () => {
    expect(evaluateAnswer(q("q7"), "I've been learning English since 2020.").verdict).toBe("correct");
    expect(evaluateAnswer(q("q7"), "I learned English since 2020").verdict).toBe("incorrect");
  });
});

describe("evaluateAnswer: limited writing rubric", () => {
  const w = q("q8");

  it("passes one present perfect and one past simple with a finished time", () => {
    expect(
      evaluateAnswer(w, "I have read two books this week. I watched a film yesterday.").verdict,
    ).toBe("correct");
  });

  it("asks for more when fewer than two sentences are written, without penalizing", () => {
    expect(evaluateAnswer(w, "I have read two books this week.").verdict).toBe("invalid");
  });

  it("flags the clear error of a participle with a finished time word", () => {
    const result = evaluateAnswer(w, "I have read a book yesterday. I went home last night.");
    expect(result.verdict).toBe("incorrect");
    expect(result.message).toMatch(/finished time/);
  });

  it("sends anything it cannot verify to review instead of marking it wrong", () => {
    expect(evaluateAnswer(w, "My cat is very small. The weather looks nice today.").verdict).toBe(
      "needs_review",
    );
  });
});

describe("lesson content integrity", () => {
  it("has eight questions with stable unique ids and every required field", () => {
    expect(lesson.questions).toHaveLength(8);
    expect(new Set(lesson.questions.map((x) => x.id)).size).toBe(8);
    for (const question of lesson.questions) {
      expect(question.hints.length).toBeGreaterThan(0);
      expect(question.explanation).toBeTruthy();
      expect(question.maxAttempts).toBeGreaterThan(0);
      if (question.strategy !== "limited-rubric") {
        expect(question.acceptedAnswers.length).toBeGreaterThan(0);
      }
      if (question.options) {
        for (const answer of question.acceptedAnswers) {
          expect(question.options.some((o) => o.id === answer)).toBe(true);
        }
      }
    }
  });

  it("covers all eight exercise types once", () => {
    expect(new Set(lesson.questions.map((x) => x.type)).size).toBe(8);
  });

  it("every accepted answer grades as correct against itself", () => {
    for (const question of lesson.questions) {
      for (const answer of question.acceptedAnswers) {
        expect(evaluateAnswer(question, answer).verdict).toBe("correct");
      }
    }
  });
});
