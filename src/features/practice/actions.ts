import type { Lesson } from "@/types/lesson";
import type { Session, StoredState } from "@/types/session";
import { updateState } from "@/lib/storage/store";
import {
  abandonSession,
  advance,
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
export function startSession(lesson: Lesson, now = Date.now()): string {
  const id = newId();
  updateState((state) => {
    const sessions = state.sessions.map((s) => abandonSession(s, now));
    return withActive(state, [...sessions, createSession(lesson, id, now)], id);
  });
  return id;
}

function mutate(sessionId: string, fn: (session: Session) => Session): void {
  updateState((state) => {
    const sessions = state.sessions.map((s) => (s.id === sessionId ? fn(s) : s));
    return withActive(state, sessions, state.activeSessionId);
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
