import type { Lesson, Question } from "@/types/lesson";
import type {
  Classification,
  LessonState,
  QuestionRecord,
  Resolution,
  Session,
} from "@/types/session";
import { evaluateAnswer } from "./grading";
import { normalizeAnswer } from "./normalize";

/** Idle gaps longer than this count as this many ms of practice, not the full gap. */
export const MAX_IDLE_GAP_MS = 2 * 60 * 1000;

function emptyRecord(questionId: string): QuestionRecord {
  return {
    questionId,
    attempts: [],
    hintsUsed: 0,
    whyViewed: false,
    classification: null,
    resolution: "open",
    finalAnswer: null,
  };
}

export function createSession(lesson: Lesson, id: string, now: number): Session {
  return {
    id,
    lessonId: lesson.id,
    status: "in_progress",
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    activeMs: 0,
    lastActiveAt: now,
    currentIndex: 0,
    phase: "answering",
    draft: "",
    records: lesson.questions.map((q) => emptyRecord(q.id)),
  };
}

/** Stamps activity and accumulates active time, capping idle gaps. */
function touch(session: Session, now: number): Session {
  const gap = Math.max(0, now - session.lastActiveAt);
  return {
    ...session,
    activeMs: session.activeMs + Math.min(gap, MAX_IDLE_GAP_MS),
    lastActiveAt: now,
    updatedAt: now,
  };
}

export function deriveLessonState(session: Session | null | undefined): LessonState {
  if (!session || session.status === "abandoned") return "not_started";
  if (session.status === "completed") return "completed";
  return session.phase === "feedback" ? "showing_feedback" : "awaiting_answer";
}

export function currentRecord(session: Session): QuestionRecord {
  return session.records[session.currentIndex];
}

export function currentQuestion(session: Session, lesson: Lesson): Question {
  return lesson.questions[session.currentIndex];
}

function replaceRecord(session: Session, record: QuestionRecord): Session {
  return {
    ...session,
    records: session.records.map((r, i) => (i === session.currentIndex ? record : r)),
  };
}

export function setDraft(session: Session, draft: string, now: number): Session {
  if (session.status !== "in_progress" || session.phase !== "answering") return session;
  return touch({ ...session, draft }, now);
}

/** Reveals the next pre-authored hint for the current question. */
export function revealHint(session: Session, lesson: Lesson, now: number): Session {
  if (session.status !== "in_progress") return session;
  const question = currentQuestion(session, lesson);
  const record = currentRecord(session);
  if (record.resolution !== "open" || record.hintsUsed >= question.hints.length) return session;
  const next = replaceRecord(session, { ...record, hintsUsed: record.hintsUsed + 1 });
  // Asking for a hint from the feedback panel returns the learner to the answer field to retry.
  const draft = session.phase === "feedback" && question.options ? "" : session.draft;
  return touch({ ...next, phase: "answering", draft }, now);
}

export function markWhyViewed(session: Session, now: number): Session {
  const record = currentRecord(session);
  if (record.whyViewed) return session;
  return touch(replaceRecord(session, { ...record, whyViewed: true }), now);
}

export function classify(record: Pick<QuestionRecord, "attempts" | "hintsUsed">, correct: boolean): Classification {
  if (!correct) return "incorrect";
  if (record.hintsUsed > 0) return "correct_after_hint";
  if (record.attempts.length > 1) return "correct_after_retry";
  return "correct_first_try";
}

export type SubmitOutcome =
  | { kind: "ignored" }
  | { kind: "invalid"; message: string }
  | { kind: "unchanged"; message: string }
  | { kind: "submitted" };

/**
 * Submits the current draft. Returns the new session and what happened.
 * Duplicate submissions (already showing feedback) and empty drafts never create attempts.
 */
export function submitAnswer(
  session: Session,
  lesson: Lesson,
  now: number,
): { session: Session; outcome: SubmitOutcome } {
  if (session.status !== "in_progress" || session.phase !== "answering") {
    return { session, outcome: { kind: "ignored" } };
  }
  const question = currentQuestion(session, lesson);
  const record = currentRecord(session);
  const answer = session.draft;

  const result = evaluateAnswer(question, answer);
  if (result.verdict === "invalid") {
    return { session, outcome: { kind: "invalid", message: result.message ?? "Add an answer first." } };
  }

  // Re-submitting the same wrong answer is not a new attempt; ask for a change instead.
  const last = record.attempts[record.attempts.length - 1];
  if (last && last.verdict === "incorrect" && normalizeAnswer(last.answer) === normalizeAnswer(answer)) {
    return {
      session,
      outcome: { kind: "unchanged", message: "Change something in your answer before trying again." },
    };
  }

  const attempts = [
    ...record.attempts,
    {
      answer,
      verdict: result.verdict,
      at: now,
      hintsUsedBefore: record.hintsUsed,
      message: result.message,
    },
  ];
  const withAttempt = { ...record, attempts };

  let resolution: Resolution = "open";
  let classification: Classification | null = null;
  let finalAnswer: string | null = null;

  if (result.verdict === "correct") {
    resolution = "correct";
    classification = classify(withAttempt, true);
    finalAnswer = answer;
  } else if (result.verdict === "needs_review") {
    // Could not be evaluated reliably: never penalize, never claim it was correct.
    resolution = "needs_review";
    finalAnswer = answer;
  } else if (attempts.length >= question.maxAttempts) {
    resolution = "exhausted";
    classification = "incorrect";
    finalAnswer = answer;
  }

  const next = replaceRecord(session, {
    ...withAttempt,
    resolution,
    classification,
    finalAnswer,
  });
  return { session: touch({ ...next, phase: "feedback" }, now), outcome: { kind: "submitted" } };
}

/** Whether the current feedback offers another try. */
export function canRetry(session: Session): boolean {
  return session.phase === "feedback" && currentRecord(session).resolution === "open";
}

/** Returns from an incorrect-answer panel to the answer field. */
export function retry(session: Session, lesson: Lesson, now: number): Session {
  if (!canRetry(session)) return session;
  // Multiple-choice picks are cleared so the learner chooses again; typed text is kept to edit.
  const draft = currentQuestion(session, lesson).options ? "" : session.draft;
  return touch({ ...session, phase: "answering", draft }, now);
}

export function isLastQuestion(session: Session): boolean {
  return session.currentIndex >= session.records.length - 1;
}

/** Moves on after feedback. Completes the session after the last question. */
export function advance(session: Session, now: number): Session {
  if (session.status !== "in_progress" || session.phase !== "feedback") return session;
  if (currentRecord(session).resolution === "open") return session;
  const touched = touch(session, now);
  if (isLastQuestion(session)) {
    return { ...touched, status: "completed", completedAt: now, phase: "feedback", draft: "" };
  }
  return { ...touched, currentIndex: session.currentIndex + 1, phase: "answering", draft: "" };
}

export function abandonSession(session: Session, now: number): Session {
  if (session.status !== "in_progress") return session;
  return { ...session, status: "abandoned", updatedAt: now };
}

export interface WritingEvaluation {
  outcome: "meets_goal" | "needs_work" | "unclear";
  confidence: "low" | "medium" | "high";
}

/**
 * Applies optional AI feedback to an answer that was saved as unverified.
 *
 * The AI can only ever help the learner: a confident "meets_goal" upgrades the answer to correct
 * (classified from the attempts and hints actually used). "needs_work" and "unclear" never mark
 * anything incorrect: the answer stays "needs review" and the feedback is simply shown.
 * Closed-ended answers are never touched.
 */
export function applyWritingEvaluation(
  session: Session,
  lesson: Lesson,
  questionId: string,
  evaluation: WritingEvaluation,
  now: number,
): Session {
  const index = lesson.questions.findIndex((q) => q.id === questionId);
  const question = lesson.questions[index];
  const record = session.records[index];
  if (!question || !record) return session;
  if (question.strategy !== "ai-writing" && question.strategy !== "limited-rubric") return session;
  if (record.resolution !== "needs_review") return session;
  if (evaluation.outcome !== "meets_goal" || evaluation.confidence === "low") return session;

  const upgraded: QuestionRecord = {
    ...record,
    resolution: "correct",
    classification: classify(record, true),
  };
  return {
    ...session,
    updatedAt: now,
    records: session.records.map((r, i) => (i === index ? upgraded : r)),
  };
}
