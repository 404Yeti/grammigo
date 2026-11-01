import type { GuidedSession, GuidedState } from "@/types/guided";
import { canonical, tieBreak } from "./canonical";
import { parseGuidedState } from "@/features/guided/store/schema";
import { MergeError } from "./merge";

/**
 * Combining two copies of Guided Correction activity. It is a SEPARATE document from lesson progress and is merged separately, with the
 * same safety properties as `mergeLessons` (commutative, idempotent, lossless). It never touches, reads or influences mastery.
 * A session is taken whole from whichever copy is better: two devices continuing the very same guided session at once is rare, and merging
 * exercise by exercise would risk mixing two different sittings.
 */
const statusRank = { abandoned: 0, in_progress: 1, completed: 2 } as const;

function better(x: GuidedSession, y: GuidedSession): GuidedSession {
  const xDone = x.status === "completed";
  const yDone = y.status === "completed";
  if (xDone !== yDone) return xDone ? x : y;
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
  if (x.status !== y.status) return statusRank[x.status] > statusRank[y.status] ? x : y;
  return tieBreak(x, y);
}

const byStart = (p: GuidedSession, q: GuidedSession) => p.startedAt - q.startedAt || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
const chooseActive = (sessions: readonly GuidedSession[], preferred: string | null = null): string | null =>
  (preferred && sessions.some((s) => s.id === preferred && s.status === "in_progress") ? preferred : null) ??
  [...sessions].filter((s) => s.status === "in_progress").sort((p, q) => q.updatedAt - p.updatedAt || (p.id < q.id ? -1 : 1))[0]?.id ?? null;

/** The UNION of two copies (associative, commutative, idempotent). Nothing is closed here; see `normalizeGuided`. */
export function mergeGuided(a: GuidedState, b: GuidedState): GuidedState {
  const byId = new Map<string, GuidedSession>();
  for (const s of [...a.sessions, ...b.sessions]) {
    const have = byId.get(s.id);
    byId.set(s.id, have ? better(have, s) : s);
  }
  const sessions = [...byId.values()].sort(byStart);
  const merged: GuidedState = { version: 1, sessions, activeSessionId: chooseActive(sessions) };
  const checked = parseGuidedState(JSON.stringify(merged));
  if (checked.kind !== "ok" || checked.dropped > 0) throw new MergeError("merged Guided Correction activity is not a valid saved state");
  return merged;
}

/** Tidies the way the app does on load: one session in progress at most (the latest), the rest closed, and the history capped. Idempotent. */
export function normalizeGuided(state: GuidedState, preferredActive: string | null = null): GuidedState {
  const active = chooseActive(state.sessions, preferredActive);
  const sessions = state.sessions.map((s) => (s.status === "in_progress" && s.id !== active ? { ...s, status: "abandoned" as const, stage: "done" as const } : s));
  const checked = parseGuidedState(JSON.stringify({ ...state, sessions, activeSessionId: active }));
  if (checked.kind !== "ok") throw new MergeError("normalised Guided Correction activity is not a valid saved state");
  return checked.state;
}

export const adoptGuided = (local: GuidedState, remote: GuidedState): GuidedState => normalizeGuided(mergeGuided(local, remote), local.activeSessionId);

export function guidedContainsAll(bigger: GuidedState, smaller: GuidedState): boolean {
  const ids = new Set(bigger.sessions.map((s) => s.id));
  return smaller.sessions.every((s) => ids.has(s.id));
}

export { canonical };
