import type { QuestionRecord, Session, StoredState } from "@/types/session";

export const STORAGE_KEY = "grammigo:v1";
export const STORAGE_VERSION = 1 as const;

export function emptyState(): StoredState {
  return { version: STORAGE_VERSION, sessions: [], activeSessionId: null };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const CLASSIFICATIONS = ["correct_first_try", "correct_after_hint", "correct_after_retry", "incorrect"];
const RESOLUTIONS = ["open", "correct", "exhausted", "needs_review"];
const VERDICTS = ["correct", "incorrect", "needs_review"];

function isRecord(v: unknown): v is QuestionRecord {
  return (
    isObject(v) &&
    typeof v.questionId === "string" &&
    isNum(v.hintsUsed) &&
    typeof v.whyViewed === "boolean" &&
    (v.classification === null || CLASSIFICATIONS.includes(v.classification as string)) &&
    RESOLUTIONS.includes(v.resolution as string) &&
    (v.finalAnswer === null || typeof v.finalAnswer === "string") &&
    Array.isArray(v.attempts) &&
    v.attempts.every(
      (a) =>
        isObject(a) &&
        typeof a.answer === "string" &&
        VERDICTS.includes(a.verdict as string) &&
        isNum(a.at) &&
        isNum(a.hintsUsedBefore),
    )
  );
}

function isSession(v: unknown): v is Session {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.lessonId === "string" &&
    ["in_progress", "completed", "abandoned"].includes(v.status as string) &&
    isNum(v.startedAt) &&
    (v.completedAt === null || isNum(v.completedAt)) &&
    isNum(v.updatedAt) &&
    isNum(v.activeMs) &&
    isNum(v.lastActiveAt) &&
    isNum(v.currentIndex) &&
    ["answering", "feedback"].includes(v.phase as string) &&
    typeof v.draft === "string" &&
    Array.isArray(v.records) &&
    v.records.length > 0 &&
    v.records.every(isRecord) &&
    v.currentIndex >= 0 &&
    v.currentIndex < v.records.length
  );
}

/**
 * Parses and validates persisted data. Unknown versions and malformed data yield null
 * so callers can start fresh instead of crashing on stale or corrupted storage.
 */
export function parseStoredState(raw: string | null): StoredState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || data.version !== STORAGE_VERSION || !Array.isArray(data.sessions)) return null;

  const sessions = data.sessions.filter(isSession);
  const active = typeof data.activeSessionId === "string" ? data.activeSessionId : null;
  const activeSessionId =
    active && sessions.some((s) => s.id === active && s.status === "in_progress") ? active : null;
  return { version: STORAGE_VERSION, sessions, activeSessionId };
}
