import { GUIDED_STORE_VERSION, type ExercisePhase, type GuidedExercise, type GuidedSession, type GuidedState } from "@/types/guided";
import { GUIDED_LIMITS } from "../cycle/config";

/**
 * Guided Correction history lives under its OWN key. It never shares a document with lesson
 * progress, so saving it cannot change or damage anything v0.1/v0.2 stored, and rolling the app
 * back cannot lose it. Validation is strict and per-session: one bad record never discards the rest.
 */
export const GUIDED_STORAGE_KEY = "grammigo:guided:v1";

export function emptyGuidedState(): GuidedState {
  return { version: GUIDED_STORE_VERSION, sessions: [], activeSessionId: null };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => isStr(v) && (list as readonly string[]).includes(v);

const PHASES = ["attempting", "recording", "transcribing", "confirming", "checking_opinion", "repairing", "clarifying", "unverified", "offer_show_me", "resolved"] as const;
const OUTCOMES = ["first_try", "self_corrected", "hint_assisted", "shown", "unverified"] as const;
const BASES = ["deterministic", "ai_second_opinion", "none"] as const;
const CATEGORIES = ["pp_with_finished_time", "participle_form", "since_without_perfect", "since_for_confusion"] as const;
const SUSPECTED = [...CATEGORIES, "pp_without_marker", "past_simple_for_ongoing", "present_with_for", "present_for_past"] as const;
const VOICE = ["permission_denied", "unsupported", "no_speech", "failed", "timeout", "offline"] as const;
const STAGES = ["main", "transfer_intro", "transfer", "summary", "done"] as const;
const FIT = ["fits", "off_prompt", "incomplete", "grammar_concern", "unclear"] as const;
const CONF = ["low", "medium", "high"] as const;
const SOURCES = ["typed", "spoken"] as const;

function cleanAttempt(a: unknown): GuidedExercise["attempts"][number] | null {
  if (!isObject(a) || !isStr(a.text) || !oneOf(a.source, SOURCES) || !isNum(a.at) || !oneOf(a.verdict, ["correct", "incorrect", "uncertain"] as const)) return null;
  const opinion = isObject(a.opinion) && oneOf(a.opinion.fit, FIT) && oneOf(a.opinion.confidence, CONF) ? { fit: a.opinion.fit, confidence: a.opinion.confidence, suspected: oneOf(a.opinion.suspected, CATEGORIES) ? a.opinion.suspected : null } : null;
  const t = a.transcript;
  const transcript = isObject(t) && isStr(t.raw) && Array.isArray(t.lowConfidenceWords) ? { raw: t.raw, edited: t.edited === true, lowConfidenceWords: t.lowConfidenceWords.filter(isStr).slice(0, 30) } : null;
  return {
    text: a.text.slice(0, GUIDED_LIMITS.maxStoredText), source: a.source, at: a.at, verdict: a.verdict,
    category: oneOf(a.category, CATEGORIES) ? a.category : null, suspected: oneOf(a.suspected, SUSPECTED) ? a.suspected : null,
    notAnAttempt: a.notAnAttempt === true, opinion, transcript,
  };
}

function cleanExercise(e: unknown): GuidedExercise | null {
  if (!isObject(e) || !isStr(e.id) || !isStr(e.itemId) || !oneOf(e.kind, ["main", "transfer"] as const) || !oneOf(e.phase, PHASES) || !isNum(e.startedAt) || !isNum(e.updatedAt) || !Array.isArray(e.attempts)) return null;
  const attempts = e.attempts.map(cleanAttempt);
  if (attempts.some((a) => a === null)) return null;

  let outcome: GuidedExercise["outcome"] = null;
  if (isObject(e.outcome) && oneOf(e.outcome.kind, OUTCOMES) && oneOf(e.outcome.basis, BASES) && isNum(e.outcome.at)) {
    outcome = { kind: e.outcome.kind, basis: e.outcome.basis, source: oneOf(e.outcome.source, SOURCES) ? e.outcome.source : null, at: e.outcome.at };
  }
  // A resolved exercise must carry an outcome, and only a resolved one may.
  if ((e.phase === "resolved") !== (outcome !== null)) return null;

  const pending = e.pendingTranscript;
  const pendingTranscript = isObject(pending) && isStr(pending.raw) && Array.isArray(pending.lowConfidenceWords) ? { raw: pending.raw, edited: pending.edited === true, lowConfidenceWords: pending.lowConfidenceWords.filter(isStr).slice(0, 30) } : null;
  const ladder = isObject(e.ladder) ? { marker: isStr(e.ladder.marker) ? e.ladder.marker : null, aux: isStr(e.ladder.aux) ? e.ladder.aux : null, verb: isStr(e.ladder.verb) ? e.ladder.verb : null } : null;
  const clarify = isObject(e.clarify) && oneOf(e.clarify.kind, ["incomplete", "off_prompt", "grammar_guidance"] as const) ? { kind: e.clarify.kind, suspected: oneOf(e.clarify.suspected, CATEGORIES) ? e.clarify.suspected : null } : null;
  const rung = e.rung === 1 || e.rung === 2 || e.rung === 3 ? e.rung : 0;

  let phase = e.phase as ExercisePhase;
  let returnPhase = oneOf(e.returnPhase, PHASES) ? e.returnPhase : "attempting";
  let unverifiedReason = isStr(e.unverifiedReason) ? e.unverifiedReason : null;
  // After a refresh: a recording cannot resume, and a pending AI request is gone. Neither costs the learner anything.
  if (phase === "recording" || phase === "transcribing") phase = returnPhase === "recording" || returnPhase === "transcribing" ? "attempting" : returnPhase;
  if (phase === "checking_opinion") { phase = "unverified"; returnPhase = "unverified"; unverifiedReason = "opinion_interrupted"; }
  if (phase === "confirming" && !pendingTranscript) phase = "attempting";

  return {
    id: e.id, itemId: e.itemId, kind: e.kind, phase, returnPhase, inputMode: oneOf(e.inputMode, SOURCES) ? e.inputMode : "typed",
    draft: isStr(e.draft) ? e.draft.slice(0, GUIDED_LIMITS.maxStoredText) : "", pendingTranscript, voiceIssue: oneOf(e.voiceIssue, VOICE) ? e.voiceIssue : null,
    attempts: attempts as GuidedExercise["attempts"], retriesUsed: isNum(e.retriesUsed) ? Math.max(0, Math.min(10, Math.floor(e.retriesUsed))) : 0,
    rung, hintsUsed: isNum(e.hintsUsed) ? Math.max(0, Math.min(2, Math.floor(e.hintsUsed))) : 0, category: oneOf(e.category, CATEGORIES) ? e.category : null,
    ladder, clarify, notice: e.notice === "not_an_attempt" ? "not_an_attempt" : null,
    opinionsUsed: isNum(e.opinionsUsed) ? Math.max(0, Math.min(10, Math.floor(e.opinionsUsed))) : 0,
    clarificationsUsed: isNum(e.clarificationsUsed) ? Math.max(0, Math.min(10, Math.floor(e.clarificationsUsed))) : 0,
    nonAttempts: isNum(e.nonAttempts) ? Math.max(0, Math.min(10, Math.floor(e.nonAttempts))) : 0, unverifiedReason, outcome,
    startedAt: e.startedAt, updatedAt: e.updatedAt,
  };
}

function cleanSession(s: unknown): GuidedSession | null {
  if (!isObject(s) || !isStr(s.id) || !isStr(s.skillId) || !oneOf(s.status, ["in_progress", "completed", "abandoned"] as const) || !oneOf(s.stage, STAGES) || !Array.isArray(s.exercises) || !isNum(s.startedAt) || !isNum(s.updatedAt)) return null;
  const exercises = s.exercises.map(cleanExercise);
  if (exercises.length === 0 || exercises.some((e) => e === null)) return null;
  return {
    id: s.id, skillId: s.skillId, status: s.status, stage: s.stage, exercises: exercises as GuidedExercise[], transferDeclined: s.transferDeclined === true,
    startedAt: s.startedAt, updatedAt: s.updatedAt, completedAt: isNum(s.completedAt) ? s.completedAt : null,
  };
}

/** Newest finished sessions are kept; the in-progress one is never dropped. */
export function capSessions(sessions: GuidedSession[]): GuidedSession[] {
  if (sessions.length <= GUIDED_LIMITS.maxSessions) return sessions;
  const active = sessions.filter((s) => s.status === "in_progress");
  const finished = sessions.filter((s) => s.status !== "in_progress").sort((a, b) => b.updatedAt - a.updatedAt);
  return [...finished.slice(0, Math.max(0, GUIDED_LIMITS.maxSessions - active.length)), ...active].sort((a, b) => a.startedAt - b.startedAt);
}

export type GuidedParse =
  | { kind: "empty" }
  | { kind: "ok"; state: GuidedState; dropped: number }
  | { kind: "corrupt" }
  /** Written by a newer version of the app. Read nothing, overwrite nothing. */
  | { kind: "future"; version: number };

export function parseGuidedState(raw: string | null): GuidedParse {
  if (raw === null) return { kind: "empty" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }
  if (!isObject(data) || !isNum(data.version) || !Array.isArray(data.sessions)) return { kind: "corrupt" };
  if (data.version > GUIDED_STORE_VERSION) return { kind: "future", version: data.version };
  if (data.version !== GUIDED_STORE_VERSION) return { kind: "corrupt" };

  const cleaned = data.sessions.map(cleanSession);
  const valid = cleaned.filter((s): s is GuidedSession => s !== null);
  // At most one in-progress session: the most recently touched one. Any other is closed without an outcome change.
  const inProgress = valid.filter((s) => s.status === "in_progress").sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = inProgress[0]?.id ?? null;
  const sessions = capSessions(valid.map((s) => (s.status === "in_progress" && s.id !== keep ? { ...s, status: "abandoned" as const, stage: "done" as const } : s)));
  return { kind: "ok", state: { version: GUIDED_STORE_VERSION, sessions, activeSessionId: keep }, dropped: cleaned.length - valid.length };
}
