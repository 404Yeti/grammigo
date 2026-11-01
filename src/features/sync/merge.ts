import type { OnboardingState, Session, StoredState } from "@/types/session";
import type { DiagnosticRun } from "@/features/diagnostic/engine";
import { parseStoredState } from "@/lib/storage/schema";
import { canonical, tieBreak } from "./canonical";

/**
 * Combining two copies of one learner's lesson progress (this device's and the account's) into one that contains everything from both.
 *
 * The rules are chosen so that merging is SAFE TO REPEAT AND SAFE TO INTERRUPT:
 *   - commutative: merge(a, b) equals merge(b, a), so which device merges first does not matter;
 *   - idempotent:  merge(a, a) equals a, and merging again with something already merged changes nothing, so a retried save is harmless;
 *   - lossless:    every session, quick-check run and piece of AI feedback present in either copy is present in the result.
 * It touches only what was SAVED. Mastery, the learning profile and recommendations are never stored; they are derived afterwards, from the
 * merged sessions, by the same deterministic code as always.
 */
const statusRank = { abandoned: 0, in_progress: 1, completed: 2 } as const;

function betterSession(x: Session, y: Session): Session {
  const xDone = x.status === "completed";
  const yDone = y.status === "completed";
  if (xDone !== yDone) return xDone ? x : y; // finished work always beats work in progress
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
  if (x.status !== y.status) return statusRank[x.status] > statusRank[y.status] ? x : y;
  return tieBreak(x, y);
}

const byStart = (p: Session, q: Session) => p.startedAt - q.startedAt || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);

/**
 * The session that should be "the active one" among those in progress: the most recently touched, ties by id (a pure function of the set).
 * `preferred` is the learner's OWN current lesson on this device: while it is still in progress it stays active, so folding in another device's
 * copy never takes away a lesson someone is in the middle of.
 */
function chooseActive(sessions: readonly Session[], preferred: string | null = null): string | null {
  if (preferred && sessions.some((s) => s.id === preferred && s.status === "in_progress")) return preferred;
  const open = sessions.filter((s) => s.status === "in_progress").sort((p, q) => q.updatedAt - p.updatedAt || (p.id < q.id ? -1 : 1));
  return open[0]?.id ?? null;
}

function mergeSessions(a: Session[], b: Session[]): { sessions: Session[]; activeSessionId: string | null } {
  const byId = new Map<string, Session>();
  for (const s of [...a, ...b]) {
    const have = byId.get(s.id);
    byId.set(s.id, have ? betterSession(have, s) : s);
  }
  // A pure union. Nothing is closed or dropped here: closing a session early would throw away what a later merge needs to know.
  const sessions = [...byId.values()].sort(byStart);
  return { sessions, activeSessionId: chooseActive(sessions) };
}

const onboardingRank = { not_started: 0, skipped: 1, in_progress: 2, completed: 3 } as const;
const lastTouched = (o: OnboardingState) => Math.max(o.completedAt ?? 0, o.startedAt ?? 0);

function mergeOnboarding(x: OnboardingState, y: OnboardingState): OnboardingState {
  if (lastTouched(x) !== lastTouched(y)) return lastTouched(x) > lastTouched(y) ? x : y; // the more recent decision (including a retake) wins
  if (x.status !== y.status) return onboardingRank[x.status] > onboardingRank[y.status] ? x : y;
  return tieBreak(x, y);
}

const runWhen = (r: DiagnosticRun) => r.finishedAt ?? r.startedAt;
function betterRun(x: DiagnosticRun, y: DiagnosticRun): DiagnosticRun {
  const xDone = x.finishedAt !== null;
  const yDone = y.finishedAt !== null;
  if (xDone !== yDone) return xDone ? x : y;
  if (runWhen(x) !== runWhen(y)) return runWhen(x) > runWhen(y) ? x : y;
  return tieBreak(x, y);
}

function mergeRuns(a: DiagnosticRun[], b: DiagnosticRun[]): DiagnosticRun[] {
  const byId = new Map<string, DiagnosticRun>();
  for (const r of [...a, ...b]) {
    const have = byId.get(r.id);
    byId.set(r.id, have ? betterRun(have, r) : r);
  }
  return [...byId.values()].sort((p, q) => p.startedAt - q.startedAt || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

function later<T extends { at: number }>(x: T | null, y: T | null): T | null {
  if (!x) return y;
  if (!y) return x;
  return x.at !== y.at ? (x.at > y.at ? x : y) : tieBreak(x, y);
}

export class MergeError extends Error {}

/**
 * Merges two copies of the lesson document into their UNION. Throws MergeError rather than ever returning something the app would not
 * accept as its own. The union is associative, commutative and idempotent. To adopt it as the device's own saved state, use `adoptLessons`.
 */
export function mergeLessons(a: StoredState, b: StoredState): StoredState {
  const { sessions, activeSessionId } = mergeSessions(a.sessions, b.sessions);
  const goals = !a.goals ? b.goals : !b.goals ? a.goals : a.goals.updatedAt !== b.goals.updatedAt ? (a.goals.updatedAt > b.goals.updatedAt ? a.goals : b.goals) : tieBreak(a.goals, b.goals);
  const writingFeedback: StoredState["writingFeedback"] = {};
  for (const key of new Set([...Object.keys(a.writingFeedback), ...Object.keys(b.writingFeedback)])) {
    const x = a.writingFeedback[key];
    const y = b.writingFeedback[key];
    writingFeedback[key] = !x ? y : !y ? x : (later(x, y) as typeof x);
  }
  const merged: StoredState = {
    version: 2,
    sessions,
    activeSessionId,
    onboarding: mergeOnboarding(a.onboarding, b.onboarding),
    goals,
    diagnosticRuns: mergeRuns(a.diagnosticRuns, b.diagnosticRuns),
    lastRecommendation: later(a.lastRecommendation, b.lastRecommendation),
    writingFeedback,
  };
  // The result must be something the app itself would load unchanged. If not, nothing is saved and nothing is overwritten.
  // Validation only: the result must be something the app would load. (What the app would TIDY on load is done by `normalizeLessons`.)
  const checked = parseStoredState(JSON.stringify(merged));
  if (!checked) throw new MergeError("merged progress is not a valid saved state");
  if (checked.sessions.length !== merged.sessions.length || checked.diagnosticRuns.length !== merged.diagnosticRuns.length) throw new MergeError("merging would drop an item");
  return merged;
}

/**
 * Tidies a merged document the way the app tidies on load: only one lesson can be in progress, so any other in-progress session is closed
 * (its answers still count towards mastery, exactly as when a learner starts a different lesson). Deterministic and idempotent.
 */
export function normalizeLessons(state: StoredState, preferredActive: string | null = null): StoredState {
  const active = chooseActive(state.sessions, preferredActive);
  const sessions = state.sessions.map((s) => (s.status === "in_progress" && s.id !== active ? { ...s, status: "abandoned" as const } : s));
  const checked = parseStoredState(JSON.stringify({ ...state, sessions, activeSessionId: active }));
  if (!checked) throw new MergeError("normalised progress is not a valid saved state");
  return checked;
}

/**
 * What a device saves after combining its own copy with the account's: the union, tidied. This device's own lesson in progress stays the
 * active one. (So the result can differ between two devices that are BOTH mid-lesson, each keeping its own: that is deliberate, and stable,
 * because adopting again changes nothing.)
 */
export const adoptLessons = (local: StoredState, remote: StoredState): StoredState => normalizeLessons(mergeLessons(local, remote), local.activeSessionId);

/** True when `bigger` contains every session and quick-check run of `smaller` (used to prove a merge lost nothing). */
export function containsAll(bigger: StoredState, smaller: StoredState): boolean {
  const ids = new Set(bigger.sessions.map((s) => s.id));
  const runs = new Set(bigger.diagnosticRuns.map((r) => r.id));
  return smaller.sessions.every((s) => ids.has(s.id)) && smaller.diagnosticRuns.every((r) => runs.has(r.id));
}

export { canonical };
