import type { Session, StoredState } from "@/types/session";

export function getActiveSession(state: StoredState, lessonId?: string): Session | null {
  const session = state.sessions.find((s) => s.id === state.activeSessionId && s.status === "in_progress");
  if (!session) return null;
  return lessonId && session.lessonId !== lessonId ? null : session;
}

export function getSessionById(state: StoredState, id: string): Session | null {
  return state.sessions.find((s) => s.id === id) ?? null;
}

export function getCompletedSessions(state: StoredState, lessonId?: string): Session[] {
  return state.sessions
    .filter((s) => s.status === "completed" && (!lessonId || s.lessonId === lessonId))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export function getLatestCompleted(state: StoredState, lessonId?: string): Session | null {
  return getCompletedSessions(state, lessonId)[0] ?? null;
}
