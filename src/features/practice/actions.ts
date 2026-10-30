import type { Lesson } from "@/types/lesson";
import { deriveLearning, snapshotOf } from "@/features/learning/derive";
import type { RecommendationSnapshot } from "@/features/learning/recommend";
import type { Session, StoredState, StoredWritingFeedback } from "@/types/session";
import { getSnapshot, updateState } from "@/lib/storage/store";
import {
  abandonSession,
  advance,
  applyWritingEvaluation,
  createSession,
  markWhyViewed,
  retry,
  setDraft,
  submitAnswer,
  revealHint,
  type SubmitOutcome,
} from "./session";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function withActive(state: StoredState, sessions: Session[], preferred: string | null): StoredState {
  const active = sessions.find((s) => s.id === preferred && s.status === "in_progress");
  return { ...state, sessions, activeSessionId: active ? active.id : null };
}

/** Starts a brand-new attempt. Completed attempts are never touched; an unfinished one is abandoned. */
export function startSession(lesson: Lesson, now = Date.now(), recommended?: RecommendationSnapshot | null): string {
  const id = newId();
  updateState((state) => {
    const sessions = state.sessions.map((s) => abandonSession(s, now));
    const next = withActive(state, [...sessions, createSession(lesson, id, now)], id);
    // Remember what we were recommending when this lesson began, so we can explain what changed afterwards.
    return recommended ? { ...next, lastRecommendation: recommended } : next;
  });
  return id;
}

/** Starts a lesson and remembers what we were recommending, so a later change can be explained. */
export function startSessionRecommended(lesson: Lesson): string {
  const now = Date.now();
  const top = deriveLearning(getSnapshot(), now).top;
  return startSession(lesson, now, snapshotOf(top, now));
}

function mutate(sessionId: string, fn: (session: Session) => Session): void {
  updateState((state) => {
    const sessions = state.sessions.map((s) => (s.id === sessionId ? fn(s) : s));
    return withActive(state, sessions, state.activeSessionId);
  });
}

/** Stores optional AI writing feedback and, if it confidently confirms the goal, upgrades the answer. */
export function attachWritingFeedback(
  sessionId: string,
  lesson: Lesson,
  questionId: string,
  feedback: StoredWritingFeedback,
  now = Date.now(),
): void {
  updateState((state) => {
    const sessions = state.sessions.map((s) =>
      s.id === sessionId && feedback.status === "ready" && feedback.outcome && feedback.confidence
        ? applyWritingEvaluation(s, lesson, questionId, { outcome: feedback.outcome, confidence: feedback.confidence }, now)
        : s,
    );
    return {
      ...withActive(state, sessions, state.activeSessionId),
      writingFeedback: { ...state.writingFeedback, [`${sessionId}:${questionId}`]: feedback },
    };
  });
}

export const practiceActions = {
  setDraft: (sessionId: string, draft: string) =>
    mutate(sessionId, (s) => setDraft(s, draft, Date.now())),

  revealHint: (sessionId: string, lesson: Lesson) =>
    mutate(sessionId, (s) => revealHint(s, lesson, Date.now())),

  markWhyViewed: (sessionId: string) => mutate(sessionId, (s) => markWhyViewed(s, Date.now())),

  retry: (sessionId: string, lesson: Lesson) =>
    mutate(sessionId, (s) => retry(s, lesson, Date.now())),

  advance: (sessionId: string) => mutate(sessionId, (s) => advance(s, Date.now())),

  submit(sessionId: string, lesson: Lesson): SubmitOutcome {
    let outcome: SubmitOutcome = { kind: "ignored" };
    mutate(sessionId, (s) => {
      const result = submitAnswer(s, lesson, Date.now());
      outcome = result.outcome;
      return result.session;
    });
    return outcome;
  },
};
