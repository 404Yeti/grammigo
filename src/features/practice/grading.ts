import type { Question } from "@/types/lesson";
import { answersMatch, normalizeAnswer } from "./normalize";
import { evaluateWriting, precheckWriting } from "./writing-rubric";

export type Verdict = "correct" | "incorrect" | "needs_review" | "invalid";

export interface EvaluationResult {
  verdict: Verdict;
  /** A specific, grammar-focused message when we can say something more useful than the default. */
  message?: string;
}

/** Evaluates one submitted answer locally and deterministically. No network involved. */
export function evaluateAnswer(question: Question, answer: string): EvaluationResult {
  if (!answer.trim()) {
    return { verdict: "invalid", message: "Choose or type an answer first." };
  }

  switch (question.strategy) {
    case "exact-choice":
      return question.acceptedAnswers.includes(answer)
        ? { verdict: "correct" }
        : { verdict: "incorrect" };

    case "normalized-text":
    case "ordered-words": {
      if (answersMatch(answer, question.acceptedAnswers)) return { verdict: "correct" };
      const normalized = normalizeAnswer(answer);
      const misconception = question.misconceptions?.find((m) =>
        m.answers.some((candidate) => normalizeAnswer(candidate) === normalized),
      );
      return { verdict: "incorrect", message: misconception?.message };
    }

    case "limited-rubric": {
      const result = evaluateWriting(answer);
      switch (result.status) {
        case "pass":
          return { verdict: "correct" };
        case "invalid":
          return { verdict: "invalid", message: result.message };
        case "fail":
          return { verdict: "incorrect", message: result.message };
        case "unverified":
          return { verdict: "needs_review", message: result.message };
      }
    }

    case "ai-writing": {
      // No deterministic judgement exists for this answer: never mark it wrong.
      const check = precheckWriting(answer);
      if (!check.ok) return { verdict: "invalid", message: check.message };
      return {
        verdict: "needs_review",
        message: "Saved for feedback. Grammigo can’t check this kind of writing automatically yet.",
      };
    }
  }
}
