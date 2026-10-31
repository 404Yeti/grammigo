import { getGuidedItem, GUIDED_SKILL_ID } from "@/curriculum/guided";
import { evaluate as realEvaluate, type Evaluation, type EvaluationInput, type EvaluatorItem } from "@/features/guided/evaluator";
import type {
  ExercisePhase, GuidedAttempt, GuidedExercise, GuidedInputSource, GuidedOutcome, GuidedOutcomeKind, GuidedSession, OutcomeBasis,
  TranscriptMeta, VoiceIssue,
} from "@/types/guided";
import { GUIDED_LIMITS } from "./config";
import { decideOnOpinion, type OpinionResult } from "./opinion";
import { pickTransfer } from "./transfer";

/**
 * The Guided Correction state machine: ATTEMPT → NOTICE → CORRECT → UNDERSTAND → APPLY.
 *
 * Pure and immutable (like session.ts): `reduce` never mutates, never does I/O, never reads a clock.
 * Anything that must happen outside (ask the AI for a second opinion) is returned as an effect;
 * the caller performs it and sends the result back as an event. The evaluator is injected so the
 * whole machine can be tested with scripted verdicts.
 *
 * Guarantees (each has tests):
 *  - Typed and spoken answers take the same path. A spoken answer is NEVER evaluated until the
 *    learner has confirmed or edited the transcript. Voice failure never counts and never blocks typing.
 *  - An answer is only ever recorded as "incorrect" by the deterministic evaluator. The AI can help
 *    confirm a success, guide with an ungraded clarification, or leave an answer unverified. Never a failure.
 *  - Up to three retries after a first mistake; Show me is available at any time and never needs a retype.
 *  - Every exercise ends with exactly one outcome. Nothing here touches mastery, profile or recommendations.
 */

export type CycleEvent =
  | { type: "SET_MODE"; mode: GuidedInputSource }
  | { type: "EDIT"; draft: string }
  | { type: "SUBMIT" }
  | { type: "START_RECORDING" }
  | { type: "RECORDING_DONE" }
  | { type: "CANCEL_RECORDING" }
  | { type: "TRANSCRIPT_READY"; text: string; lowConfidenceWords?: string[] }
  | { type: "TRANSCRIPT_FAILED"; reason: VoiceIssue }
  | { type: "EDIT_TRANSCRIPT"; text: string }
  | { type: "CONFIRM_TRANSCRIPT" }
  | { type: "REDO_RECORDING" }
  | { type: "REQUEST_HINT" }
  | { type: "SHOW_ME" }
  | { type: "OPINION"; result: OpinionResult }
  | { type: "SKIP_OPINION" }
  | { type: "ACCEPT_AS_IS" }
  | { type: "CONTINUE" }
  | { type: "START_TRANSFER" }
  | { type: "SKIP_TRANSFER" }
  | { type: "FINISH" }
  | { type: "ABANDON" };

export type CycleEffect = { type: "request_opinion"; exerciseId: string; itemId: string; text: string; source: GuidedInputSource };

export interface CycleContext {
  now: number;
  /** Injected for tests. Defaults to the real deterministic evaluator. */
  evaluate?: (item: EvaluatorItem, input: EvaluationInput) => Evaluation;
  /** False when AI is off, offline or out of budget: uncertain answers go straight to the neutral path. */
  aiAvailable?: boolean;
  /** Items this learner has already seen, so transfer practice rotates. */
  seenItemIds?: readonly string[];
}

export interface CycleResult {
  session: GuidedSession;
  effects: CycleEffect[];
  /** Why the event was ignored. The session is returned unchanged. */
  rejected: string | null;
}

const INTERACTIVE: ReadonlySet<ExercisePhase> = new Set(["attempting", "repairing", "clarifying", "unverified"]);
const PIPELINE: ReadonlySet<ExercisePhase> = new Set(["recording", "transcribing", "confirming"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

export function newExercise(id: string, itemId: string, kind: "main" | "transfer", now: number): GuidedExercise {
  return {
    id, itemId, kind, phase: "attempting", returnPhase: "attempting", inputMode: "typed", draft: "", pendingTranscript: null,
    voiceIssue: null, attempts: [], retriesUsed: 0, rung: 0, hintsUsed: 0, category: null, ladder: null, clarify: null, notice: null,
    opinionsUsed: 0, clarificationsUsed: 0, nonAttempts: 0, unverifiedReason: null, outcome: null, startedAt: now, updatedAt: now,
  };
}

export function createGuidedSession(id: string, now: number, mainItemId = "ppps-main"): GuidedSession {
  if (!getGuidedItem(mainItemId)) throw new Error(`Unknown guided item: ${mainItemId}`);
  return {
    id, skillId: GUIDED_SKILL_ID, status: "in_progress", stage: "main", exercises: [newExercise(`${id}:main`, mainItemId, "main", now)],
    transferDeclined: false, startedAt: now, updatedAt: now, completedAt: null,
  };
}

export const currentExercise = (s: GuidedSession): GuidedExercise | null => s.exercises[s.exercises.length - 1] ?? null;
export const mainExercise = (s: GuidedSession): GuidedExercise | null => s.exercises.find((e) => e.kind === "main") ?? null;

/* ----------------------------------------------------------------- outcomes */

const counted = (e: GuidedExercise) => e.attempts.filter((a) => !a.notAnAttempt);

function resolve(e: GuidedExercise, kind: GuidedOutcomeKind, basis: OutcomeBasis, source: GuidedInputSource | null, now: number): GuidedExercise {
  const outcome: GuidedOutcome = { kind, basis, source, at: now };
  return { ...e, phase: "resolved", returnPhase: "resolved", outcome, pendingTranscript: null, clarify: null, notice: null, voiceIssue: null, updatedAt: now };
}

/**
 * Whether the learner was told something corrective before this answer: an earlier answer the
 * deterministic check marked incorrect (which brings the notice and the hints), a hint, or an
 * AI-triggered grammar clarification. An answer that was merely unverified, incomplete or off-topic
 * is none of these. With a clarification limit of one, guidance was shown exactly when the FIRST
 * clarification-eligible opinion was a grammar concern.
 */
export function wasCorrectedBefore(e: GuidedExercise): boolean {
  const earlier = counted(e).slice(0, -1);
  if (earlier.some((a) => a.verdict === "incorrect") || e.hintsUsed > 0) return true;
  const firstEligible = earlier.map((a) => a.opinion).find((o) => o && o.confidence !== "low" && (o.fit === "grammar_concern" || o.fit === "incomplete" || o.fit === "off_prompt"));
  return firstEligible?.fit === "grammar_concern";
}

/**
 * The deciding answer is the first VERIFIED correct one. First try if nothing corrective came before it
 * (earlier unverified submissions are tracked separately and do not disqualify); otherwise fixed after a hint,
 * or fixed after the neutral notice only.
 */
function resolveSuccess(e: GuidedExercise, basis: OutcomeBasis, source: GuidedInputSource, now: number): GuidedExercise {
  const kind: GuidedOutcomeKind = !wasCorrectedBefore(e) ? "first_try" : e.hintsUsed > 0 ? "hint_assisted" : "self_corrected";
  return resolve(e, kind, basis, source, now);
}

const resolveShown = (e: GuidedExercise, now: number) => resolve(e, "shown", "none", null, now);
const resolveUnverified = (e: GuidedExercise, reason: string, now: number) => ({ ...resolve(e, "unverified", "none", null, now), unverifiedReason: reason });

function toUnverifiedPhase(e: GuidedExercise, reason: string, now: number): GuidedExercise {
  return { ...e, phase: "unverified", returnPhase: "unverified", unverifiedReason: reason, clarify: null, updatedAt: now };
}

/* ----------------------------------------------------------------- attempts */

interface Step {
  ex: GuidedExercise;
  effects: CycleEffect[];
  rejected: string | null;
}
const same = (ex: GuidedExercise, rejected: string): Step => ({ ex, effects: [], rejected });
const step = (ex: GuidedExercise, effects: CycleEffect[] = []): Step => ({ ex, effects, rejected: null });

function submitAttempt(ex: GuidedExercise, rawText: string, source: GuidedInputSource, transcript: TranscriptMeta | null, ctx: CycleContext): Step {
  const text = rawText.trim();
  if (!text) return same(ex, "empty");
  const item = getGuidedItem(ex.itemId);
  if (!item) return same(ex, "unknown_item");

  // Re-submitting the same wrong answer is not a new attempt; ask for a change instead.
  const lastCounted = counted(ex).at(-1);
  if (lastCounted && lastCounted.verdict === "incorrect" && norm(lastCounted.text) === norm(text)) return same(ex, "unchanged");

  const evalFn = ctx.evaluate ?? realEvaluate;
  const ev = evalFn({ id: item.id, frame: item.frame, categories: item.categories }, { text, source });
  const attempt: GuidedAttempt = {
    text: text.slice(0, GUIDED_LIMITS.maxStoredText), source, at: ctx.now, verdict: ev.verdict, category: ev.category, suspected: ev.suspected,
    notAnAttempt: ev.notAnAttempt, opinion: null, transcript,
  };
  const base: GuidedExercise = { ...ex, attempts: [...ex.attempts, attempt], draft: "", pendingTranscript: null, voiceIssue: ex.voiceIssue, notice: null, updatedAt: ctx.now };

  // Nothing to judge: never an attempt, never a retry, never a penalty.
  if (ev.notAnAttempt) {
    const nonAttempts = ex.nonAttempts + 1;
    if (nonAttempts >= GUIDED_LIMITS.maxNonAttempts) return step(resolveUnverified({ ...base, nonAttempts }, "no_answer_to_judge", ctx.now));
    const phase = INTERACTIVE.has(ex.phase) ? ex.phase : ex.returnPhase;
    return step({ ...base, phase, nonAttempts, notice: "not_an_attempt" });
  }
  const exAfter: GuidedExercise = { ...base, nonAttempts: 0 };

  if (ev.verdict === "correct") return step(resolveSuccess(exAfter, "deterministic", source, ctx.now));

  if (ev.verdict === "incorrect") {
    const incorrect = counted(exAfter).filter((a) => a.verdict === "incorrect").length;
    const retriesUsed = Math.max(0, incorrect - 1);
    const limit = ex.kind === "transfer" ? GUIDED_LIMITS.transferRetries : GUIDED_LIMITS.maxRetries;
    const next: GuidedExercise = {
      ...exAfter, retriesUsed, category: ev.category, ladder: { marker: ev.marker, aux: ev.aux, verb: ev.verb },
      rung: Math.max(exAfter.rung, 1) as GuidedExercise["rung"], clarify: null, unverifiedReason: null,
      phase: retriesUsed >= limit ? "offer_show_me" : "repairing", returnPhase: "repairing",
    };
    return step(next);
  }

  // Uncertain: a bounded AI second opinion if allowed, otherwise the neutral path. Never a verdict.
  const canAsk = ctx.aiAvailable !== false && exAfter.opinionsUsed < GUIDED_LIMITS.maxOpinions;
  if (canAsk) {
    return step(
      { ...exAfter, phase: "checking_opinion", returnPhase: "checking_opinion", opinionsUsed: exAfter.opinionsUsed + 1, clarify: null },
      [{ type: "request_opinion", exerciseId: ex.id, itemId: ex.itemId, text: attempt.text, source }],
    );
  }
  return step(toUnverifiedPhase(exAfter, ctx.aiAvailable === false ? "second_opinion_unavailable" : "no_more_opinions", ctx.now));
}

function applyOpinion(ex: GuidedExercise, result: OpinionResult, ctx: CycleContext): Step {
  if (ex.phase !== "checking_opinion") return same(ex, "not_waiting_for_opinion");
  const item = getGuidedItem(ex.itemId);
  if (!item) return same(ex, "unknown_item");
  if (result.status === "failed") return step(toUnverifiedPhase(ex, `opinion_${result.reason}`, ctx.now));

  // Keep what the AI said on the answer it was about (history only; it is not a verdict).
  const attempts = ex.attempts.map((a, i, all) => (i === all.length - 1 ? { ...a, opinion: result.opinion } : a));
  const withOpinion: GuidedExercise = { ...ex, attempts };
  const decision = decideOnOpinion(result.opinion, { clarificationsUsed: ex.clarificationsUsed, itemCategories: item.categories });
  const last = attempts[attempts.length - 1];

  switch (decision.action) {
    case "accept_fit":
      return step(resolveSuccess(withOpinion, "ai_second_opinion", last.source, ctx.now));
    case "clarify":
      return step({
        ...withOpinion, phase: "clarifying", returnPhase: "clarifying", clarificationsUsed: ex.clarificationsUsed + 1,
        clarify: { kind: decision.kind, suspected: decision.suspected }, updatedAt: ctx.now,
      });
    case "unverified":
      return step(toUnverifiedPhase(withOpinion, `opinion_${decision.reason}`, ctx.now));
  }
}

/* ------------------------------------------------------------------ exercise */

function reduceExercise(ex: GuidedExercise, event: CycleEvent, ctx: CycleContext): Step {
  const now = ctx.now;
  const touch = (e: GuidedExercise): GuidedExercise => ({ ...e, updatedAt: now });

  switch (event.type) {
    case "SET_MODE": {
      if (event.mode === "spoken" && ex.voiceIssue === "unsupported") return same(ex, "voice_unavailable");
      if (PIPELINE.has(ex.phase)) {
        if (event.mode === "spoken") return same(ex, "already_speaking");
        // Back to typing: keep whatever the learner was editing, drop the recording.
        return step(touch({ ...ex, inputMode: "typed", phase: ex.returnPhase, pendingTranscript: null }));
      }
      if (!INTERACTIVE.has(ex.phase)) return same(ex, "not_available_now");
      return step(touch({ ...ex, inputMode: event.mode }));
    }
    case "EDIT": {
      if (!INTERACTIVE.has(ex.phase)) return same(ex, "not_available_now");
      return step(touch({ ...ex, draft: event.draft, inputMode: "typed", notice: null }));
    }
    case "SUBMIT": {
      if (!INTERACTIVE.has(ex.phase)) return same(ex, "not_available_now");
      return submitAttempt(ex, ex.draft, "typed", null, ctx);
    }
    case "START_RECORDING": {
      if (!INTERACTIVE.has(ex.phase)) return same(ex, "not_available_now");
      if (ex.voiceIssue === "unsupported") return same(ex, "voice_unavailable");
      return step(touch({ ...ex, phase: "recording", returnPhase: ex.phase, inputMode: "spoken", voiceIssue: null, pendingTranscript: null, notice: null }));
    }
    case "RECORDING_DONE": {
      if (ex.phase !== "recording") return same(ex, "not_recording");
      return step(touch({ ...ex, phase: "transcribing" }));
    }
    case "CANCEL_RECORDING": {
      if (!PIPELINE.has(ex.phase)) return same(ex, "not_recording");
      return step(touch({ ...ex, phase: ex.returnPhase, pendingTranscript: null, draft: "" }));
    }
    case "TRANSCRIPT_READY": {
      if (ex.phase !== "transcribing") return same(ex, "not_transcribing");
      const text = event.text.trim();
      if (!text) return step(touch({ ...ex, phase: ex.returnPhase, voiceIssue: "no_speech", inputMode: "typed", pendingTranscript: null }));
      return step(touch({ ...ex, phase: "confirming", draft: text, pendingTranscript: { raw: text, edited: false, lowConfidenceWords: event.lowConfidenceWords ?? [] } }));
    }
    case "TRANSCRIPT_FAILED": {
      if (ex.phase !== "recording" && ex.phase !== "transcribing") return same(ex, "not_recording");
      // Voice failure is never an attempt and never a penalty. Typing is always one step away.
      return step(touch({ ...ex, phase: ex.returnPhase, voiceIssue: event.reason, inputMode: "typed", pendingTranscript: null }));
    }
    case "EDIT_TRANSCRIPT": {
      if (ex.phase !== "confirming" || !ex.pendingTranscript) return same(ex, "not_confirming");
      return step(touch({ ...ex, draft: event.text, pendingTranscript: { ...ex.pendingTranscript, edited: norm(event.text) !== norm(ex.pendingTranscript.raw) } }));
    }
    case "CONFIRM_TRANSCRIPT": {
      if (ex.phase !== "confirming" || !ex.pendingTranscript) return same(ex, "not_confirming");
      const meta: TranscriptMeta = { ...ex.pendingTranscript, edited: norm(ex.draft) !== norm(ex.pendingTranscript.raw) };
      const s = submitAttempt({ ...ex, phase: ex.returnPhase }, ex.draft, "spoken", meta, ctx);
      // An empty confirmation changes nothing: the learner is still at the confirm step.
      return s.rejected ? same(ex, s.rejected === "unchanged" ? "unchanged" : "empty_transcript") : s;
    }
    case "REDO_RECORDING": {
      if (ex.phase !== "confirming") return same(ex, "not_confirming");
      return step(touch({ ...ex, phase: "recording", pendingTranscript: null, draft: "" }));
    }
    case "REQUEST_HINT": {
      if (ex.kind === "transfer") return same(ex, "no_hints_in_transfer");
      if (ex.phase !== "repairing" || ex.rung < 1) return same(ex, "hint_not_available");
      if (ex.rung >= 3) return same(ex, "no_more_hints");
      return step(touch({ ...ex, rung: (ex.rung + 1) as GuidedExercise["rung"], hintsUsed: ex.hintsUsed + 1 }));
    }
    case "SHOW_ME": {
      if (ex.phase === "resolved") return same(ex, "already_resolved");
      return step(resolveShown(ex, now)); // available at any time, including before the first answer; never needs a retype
    }
    case "OPINION":
      return applyOpinion(ex, event.result, ctx);
    case "SKIP_OPINION": {
      if (ex.phase !== "checking_opinion") return same(ex, "not_waiting_for_opinion");
      return step(toUnverifiedPhase(ex, "opinion_skipped", now));
    }
    case "ACCEPT_AS_IS": {
      if (ex.phase !== "unverified" && ex.phase !== "clarifying") return same(ex, "not_available_now");
      return step(resolveUnverified(ex, ex.unverifiedReason ?? "accepted_as_is", now));
    }
    default:
      return same(ex, "unsupported_event");
  }
}

/* ------------------------------------------------------------------- session */

export function reduce(session: GuidedSession, event: CycleEvent, ctx: CycleContext): CycleResult {
  const reject = (reason: string): CycleResult => ({ session, effects: [], rejected: reason });
  if (session.status !== "in_progress") return reject("session_not_active");
  const now = ctx.now;
  const withSession = (patch: Partial<GuidedSession>): CycleResult => ({ session: { ...session, ...patch, updatedAt: now }, effects: [], rejected: null });

  switch (event.type) {
    case "ABANDON":
      return withSession({ status: "abandoned", stage: "done" });

    case "CONTINUE": {
      const ex = currentExercise(session);
      if (!ex || ex.phase !== "resolved") return reject("exercise_not_resolved");
      if (session.stage === "main") return withSession({ stage: "transfer_intro" });
      if (session.stage === "transfer") return withSession({ stage: "summary" });
      return reject("nothing_to_continue");
    }

    case "START_TRANSFER": {
      if (session.stage !== "transfer_intro") return reject("not_at_transfer_intro");
      const main = mainExercise(session);
      if (!main?.outcome) return reject("main_not_resolved");
      const id = pickTransfer({ mainItemId: main.itemId, mainOutcome: main.outcome.kind, seen: ctx.seenItemIds ?? [] });
      return {
        session: { ...session, stage: "transfer", exercises: [...session.exercises, newExercise(`${session.id}:transfer`, id, "transfer", now)], updatedAt: now },
        effects: [],
        rejected: null,
      };
    }

    case "SKIP_TRANSFER": {
      if (session.stage !== "transfer_intro") return reject("not_at_transfer_intro");
      return withSession({ stage: "summary", transferDeclined: true });
    }

    case "FINISH": {
      if (session.stage !== "summary") return reject("not_at_summary");
      return withSession({ status: "completed", stage: "done", completedAt: now });
    }

    default: {
      const ex = currentExercise(session);
      if (!ex || (session.stage !== "main" && session.stage !== "transfer")) return reject("no_active_exercise");
      const s = reduceExercise(ex, event, ctx);
      if (s.rejected) return reject(s.rejected);
      const exercises = session.exercises.map((e) => (e.id === ex.id ? s.ex : e));
      return { session: { ...session, exercises, updatedAt: now }, effects: s.effects, rejected: null };
    }
  }
}
