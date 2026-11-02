import type { DiagnosticRun } from "@/features/diagnostic/engine";
import { optionalSpeakingSchema } from "@/features/diagnostic/speaking-schema";
import type {
  OnboardingState,
  QuestionRecord,
  Session,
  StoredState,
  StoredStateV1,
} from "@/types/session";

export const STORAGE_VERSION = 2 as const;
export const STORAGE_KEY = "grammigo:v2";
/** The v0.1 key. It is read for migration and never deleted, so it stays as a backup. */
export const LEGACY_STORAGE_KEY = "grammigo:v1";

export function defaultOnboarding(): OnboardingState {
  return {
    status: "not_started",
    step: "welcome",
    draftText: "",
    draftSource: "typed",
    runId: null,
    startedAt: null,
    completedAt: null,
  };
}

export function emptyState(): StoredState {
  return {
    version: STORAGE_VERSION,
    sessions: [],
    activeSessionId: null,
    onboarding: defaultOnboarding(),
    goals: null,
    diagnosticRuns: [],
    lastRecommendation: null,
    writingFeedback: {},
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

const CLASSIFICATIONS = ["correct_first_try", "correct_after_hint", "correct_after_retry", "incorrect"];
const RESOLUTIONS = ["open", "correct", "exhausted", "needs_review"];
const VERDICTS = ["correct", "incorrect", "needs_review"];

function isRecord(v: unknown): v is QuestionRecord {
  return (
    isObject(v) &&
    isStr(v.questionId) &&
    isNum(v.hintsUsed) &&
    typeof v.whyViewed === "boolean" &&
    (v.classification === null || CLASSIFICATIONS.includes(v.classification as string)) &&
    RESOLUTIONS.includes(v.resolution as string) &&
    (v.finalAnswer === null || isStr(v.finalAnswer)) &&
    Array.isArray(v.attempts) &&
    v.attempts.every(
      (a) =>
        isObject(a) &&
        isStr(a.answer) &&
        VERDICTS.includes(a.verdict as string) &&
        isNum(a.at) &&
        isNum(a.hintsUsedBefore),
    )
  );
}

export function isSession(v: unknown): v is Session {
  return (
    isObject(v) &&
    isStr(v.id) &&
    isStr(v.lessonId) &&
    ["in_progress", "completed", "abandoned"].includes(v.status as string) &&
    isNum(v.startedAt) &&
    (v.completedAt === null || isNum(v.completedAt)) &&
    isNum(v.updatedAt) &&
    isNum(v.activeMs) &&
    isNum(v.lastActiveAt) &&
    isNum(v.currentIndex) &&
    ["answering", "feedback"].includes(v.phase as string) &&
    isStr(v.draft) &&
    Array.isArray(v.records) &&
    v.records.length > 0 &&
    v.records.every(isRecord) &&
    v.currentIndex >= 0 &&
    v.currentIndex < v.records.length
  );
}

const STEPS = ["welcome", "concerns", "transcript", "confirm", "quiz", "profile", "recommendation"];
const STATUSES = ["not_started", "in_progress", "completed", "skipped"];

function parseOnboarding(v: unknown): OnboardingState {
  if (
    isObject(v) &&
    STATUSES.includes(v.status as string) &&
    STEPS.includes(v.step as string) &&
    isStr(v.draftText) &&
    ["typed", "spoken"].includes(v.draftSource as string) &&
    (v.runId === null || isStr(v.runId)) &&
    (v.startedAt === null || isNum(v.startedAt)) &&
    (v.completedAt === null || isNum(v.completedAt))
  ) {
    return v as unknown as OnboardingState;
  }
  return defaultOnboarding();
}

function isGoals(v: unknown): boolean {
  return (
    isObject(v) &&
    isStr(v.text) &&
    ["typed", "spoken", "none"].includes(v.source as string) &&
    Array.isArray(v.goals) &&
    Array.isArray(v.skillIds) &&
    v.skillIds.every(isStr) &&
    ["ai", "local", "none"].includes(v.extractedBy as string) &&
    isNum(v.updatedAt)
  );
}

function isRun(v: unknown): boolean {
  return (
    isObject(v) &&
    isStr(v.id) &&
    isNum(v.startedAt) &&
    (v.finishedAt === null || isNum(v.finishedAt)) &&
    Array.isArray(v.goalSkillIds) &&
    typeof v.extended === "boolean" &&
    Array.isArray(v.responses) &&
    v.responses.every(
      (r) => isObject(r) && isStr(r.itemId) && isStr(r.skillId) && ["correct", "incorrect", "skipped"].includes(r.outcome as string) && isNum(r.at),
    )
  );
}

/** Invalid optional samples are discarded without losing valid closed-question evidence. */
function parseRun(value: unknown): DiagnosticRun | null {
  if (!isRun(value)) return null;
  const run = { ...(value as DiagnosticRun) };
  const optional = optionalSpeakingSchema.safeParse(run.optionalSpeaking);
  delete run.optionalSpeaking;
  if (optional.success) run.optionalSpeaking = optional.data;
  return run;
}

/**
 * v1 → v2: every v0.1 session is kept untouched. New fields get defaults. A learner who already
 * used v0.1 is not forced through onboarding; it is marked skipped and offered later instead.
 */
export function migrateV1ToV2(v1: StoredStateV1): StoredState {
  const onboarding: OnboardingState =
    v1.sessions.length > 0
      ? { ...defaultOnboarding(), status: "skipped", startedAt: null, completedAt: null }
      : defaultOnboarding();
  return { ...emptyState(), sessions: v1.sessions, activeSessionId: v1.activeSessionId, onboarding };
}

function activeIdFor(sessions: Session[], candidate: unknown): string | null {
  return isStr(candidate) && sessions.some((s) => s.id === candidate && s.status === "in_progress")
    ? candidate
    : null;
}

/**
 * Parses and validates persisted data of any known version. Unknown versions and malformed
 * documents yield null so callers start fresh instead of crashing. Invalid sessions are dropped
 * individually; invalid onboarding/goal data falls back to defaults without touching sessions.
 */
export function parseStoredState(raw: string | null): StoredState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || !Array.isArray(data.sessions)) return null;

  const sessions = data.sessions.filter(isSession);
  const activeSessionId = activeIdFor(sessions, data.activeSessionId);

  if (data.version === 1) {
    return migrateV1ToV2({ version: 1, sessions, activeSessionId });
  }
  if (data.version !== STORAGE_VERSION) return null;

  return {
    version: STORAGE_VERSION,
    sessions,
    activeSessionId,
    onboarding: parseOnboarding(data.onboarding),
    goals: isGoals(data.goals) ? (data.goals as StoredState["goals"]) : null,
    diagnosticRuns: Array.isArray(data.diagnosticRuns)
      ? data.diagnosticRuns.map(parseRun).filter((run): run is DiagnosticRun => run !== null)
      : [],
    lastRecommendation:
      isObject(data.lastRecommendation) && isStr(data.lastRecommendation.skillId) && isStr(data.lastRecommendation.kind) && isNum(data.lastRecommendation.at)
        ? (data.lastRecommendation as unknown as StoredState["lastRecommendation"])
        : null,
    writingFeedback: isObject(data.writingFeedback) ? (data.writingFeedback as StoredState["writingFeedback"]) : {},
  };
}
