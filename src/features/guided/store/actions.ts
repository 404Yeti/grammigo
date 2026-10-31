import type { GuidedSession, GuidedState } from "@/types/guided";
import { createGuidedSession, reduce, type CycleContext, type CycleEvent, type CycleResult } from "../cycle/machine";
import { capSessions } from "./schema";
import { getGuidedSnapshot, updateGuided } from "./store";

/**
 * The imperative API the UI will call (Phase 3). Every function is a thin wrapper: it loads the
 * stored history, applies the pure machine, and saves the result. There is no other way to change
 * Guided Correction history, and nothing here reads or writes lesson progress.
 */

const newId = (now: number) => `g-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const activeGuidedSession = (state: GuidedState): GuidedSession | null => state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

/** Items this learner has already practised, so transfer practice rotates. */
export const seenItemIds = (state: GuidedState): string[] => [...new Set(state.sessions.flatMap((s) => s.exercises.map((e) => e.itemId)))];

/** Starts a session, or resumes the one in progress (so a refresh or a second tab never forks the learner's place). */
export function startGuidedSession(opts: { now?: number; id?: string; mainItemId?: string } = {}): GuidedSession {
  const now = opts.now ?? Date.now();
  let result!: GuidedSession;
  updateGuided((state) => {
    const existing = activeGuidedSession(state);
    if (existing && existing.status === "in_progress") {
      result = existing;
      return state;
    }
    const session = createGuidedSession(opts.id ?? newId(now), now, opts.mainItemId);
    result = session;
    return { ...state, sessions: capSessions([...state.sessions, session]), activeSessionId: session.id };
  });
  return result;
}

export interface DispatchOptions extends Partial<Omit<CycleContext, "now">> {
  now?: number;
}

/** Applies one event to a stored session and persists it. Returns what happened, including any effect to perform. */
export function dispatchGuided(sessionId: string, event: CycleEvent, opts: DispatchOptions = {}): CycleResult {
  const now = opts.now ?? Date.now();
  let out: CycleResult = { session: undefined as unknown as GuidedSession, effects: [], rejected: "unknown_session" };
  updateGuided((state) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return state;
    const r = reduce(session, event, { ...opts, now, seenItemIds: opts.seenItemIds ?? seenItemIds(state) });
    out = r;
    if (r.rejected) return state;
    const sessions = state.sessions.map((s) => (s.id === sessionId ? r.session : s));
    const activeSessionId = r.session.status === "in_progress" ? r.session.id : state.activeSessionId === r.session.id ? null : state.activeSessionId;
    return { ...state, sessions, activeSessionId };
  });
  return out;
}

export const readGuided = (): GuidedState => getGuidedSnapshot();
