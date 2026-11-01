import { getStorageScope } from "@/lib/scope/storage-scope";
import { peekStoredState } from "@/lib/storage/peek";
import { updateState } from "@/lib/storage/store";
import { updateGuided } from "@/features/guided/store/store";
import type { GuidedState } from "@/types/guided";
import type { StoredState } from "@/types/session";
import { hashDocument, hashOf } from "./canonical";
import { peekGuidedState } from "./guided-doc";
import { lessonsHasProgress } from "./doc-adapters";
import { adoptGuided } from "./merge-guided";
import { adoptLessons } from "./merge";

/**
 * Adding the GUEST's progress on this device to the signed-in learner's account: only on the learner's explicit say-so, never silently.
 *
 * What is protected here:
 *  - The guest's progress is only ever READ (a copy), then merged into the learner's own saved progress. The guest's own folder is never
 *    written, cleared or deleted, so declining, or changing your mind, costs nothing and loses nothing.
 *  - Only the GUEST's folder can be offered. Another account's folder on a shared device is never read for this, never offered, never merged.
 *  - The merge is the same lossless union used everywhere (see merge.ts); the learner's existing progress is kept.
 *  - What was added is remembered (by a one-way fingerprint) so the same progress is not offered to the same account again.
 */
const LEDGER_KEY = "grammigo:imports:v1";

export type GuestSummary = {
  hasProgress: boolean;
  lessonsCompleted: number;
  lessonsInProgress: number;
  quickChecks: number;
  guidedSessions: number;
  lastActive: number | null;
  /** Identifies THIS guest progress as it is now. It changes when the guest learns something new. */
  fingerprint: string;
};

type Ledger = { v: 1; entries: { account: string; fingerprint: string; at: number }[] };
const accountTag = (accountId: string) => hashOf(`acct:${accountId}`);

function readLedger(): Ledger {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    const d = raw ? (JSON.parse(raw) as Ledger) : null;
    return d && d.v === 1 && Array.isArray(d.entries) ? d : { v: 1, entries: [] };
  } catch {
    return { v: 1, entries: [] };
  }
}

/** The guest's saved progress (copies), or null if there is none. Never touches the guest's storage. */
export function readGuest(): { lessons: StoredState; guided: GuidedState } | null {
  const lessons = peekStoredState("");
  const guided = peekGuidedState("");
  if (!lessons && !guided) return null;
  return { lessons: lessons ?? ({ version: 2, sessions: [], activeSessionId: null, onboarding: { status: "not_started", step: "welcome", draftText: "", draftSource: "typed", runId: null, startedAt: null, completedAt: null }, goals: null, diagnosticRuns: [], lastRecommendation: null, writingFeedback: {} } as StoredState), guided: guided ?? { version: 1, sessions: [], activeSessionId: null } };
}

export function summarizeGuest(g: { lessons: StoredState; guided: GuidedState } | null): GuestSummary {
  if (!g) return { hasProgress: false, lessonsCompleted: 0, lessonsInProgress: 0, quickChecks: 0, guidedSessions: 0, lastActive: null, fingerprint: "" };
  const times = [...g.lessons.sessions.map((s) => s.updatedAt), ...g.lessons.diagnosticRuns.map((r) => r.finishedAt ?? r.startedAt), ...g.guided.sessions.map((s) => s.updatedAt)];
  const hasProgress = lessonsHasProgress(g.lessons) || g.guided.sessions.length > 0;
  return {
    hasProgress,
    lessonsCompleted: g.lessons.sessions.filter((s) => s.status === "completed").length,
    lessonsInProgress: g.lessons.sessions.filter((s) => s.status === "in_progress").length,
    quickChecks: g.lessons.diagnosticRuns.filter((r) => r.finishedAt !== null).length,
    guidedSessions: g.guided.sessions.length,
    lastActive: times.length ? Math.max(...times) : null,
    fingerprint: hasProgress ? hashDocument({ l: g.lessons, g: g.guided }) : "",
  };
}

/** Has THIS progress already been added to THIS account? */
export const alreadyAddedTo = (accountId: string, fingerprint: string): boolean => readLedger().entries.some((e) => e.account === accountTag(accountId) && e.fingerprint === fingerprint);

/** Has this progress been added to a DIFFERENT account on this device? (The learner is told, so they only add it if it is theirs.) */
export const addedToAnotherAccount = (accountId: string, fingerprint: string): boolean => readLedger().entries.some((e) => e.account !== accountTag(accountId) && e.fingerprint === fingerprint);

/**
 * Merges the guest's progress into the CURRENT learner's saved progress. Refuses to run unless an account is active (so it can never merge
 * the guest into the guest), and returns what it did.
 */
export function importGuest(accountId: string, now: number): { added: GuestSummary } {
  if (getStorageScope() !== accountId || accountId === "") throw new Error("import needs the account's own folder to be the active one");
  const guest = readGuest();
  const summary = summarizeGuest(guest);
  if (!guest || !summary.hasProgress) return { added: summary };
  updateState((cur) => adoptLessons(cur, guest.lessons));
  updateGuided((cur) => adoptGuided(cur, guest.guided));
  const ledger = readLedger();
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify({ v: 1, entries: [...ledger.entries.filter((e) => !(e.account === accountTag(accountId) && e.fingerprint === summary.fingerprint)), { account: accountTag(accountId), fingerprint: summary.fingerprint, at: now }].slice(-50) }));
  } catch {
    // the merge itself is already done and safe; the worst case is being offered the same progress once more
  }
  return { added: summary };
}
