import type { Evaluation, EvaluationInput, EvaluatorItem } from "@/features/guided/evaluator";
import type { GuidedSession } from "@/types/guided";
import { createGuidedSession, reduce, type CycleContext, type CycleEvent, type CycleResult } from "./machine";

/** Shared helpers for the Guided Correction tests. Not imported by application code. */
export const T0 = 1_800_000_000_000;

export function clock(start = T0) {
  let t = start;
  return () => (t += 1000);
}

export const evaluation = (over: Partial<Evaluation> = {}): Evaluation => ({
  verdict: "uncertain", category: null, validAlternative: false, suspected: null, notAnAttempt: false, reasons: [], marker: null, aux: null, verb: null, ...over,
});

export const CORRECT = evaluation({ verdict: "correct", reasons: ["scripted"] });
export const WRONG = evaluation({ verdict: "incorrect", category: "pp_with_finished_time", marker: "yesterday evening", aux: "have", verb: "watched", reasons: ["scripted"] });
export const UNSURE = evaluation({ verdict: "uncertain", suspected: "pp_without_marker", reasons: ["scripted"] });
export const NOTHING = evaluation({ verdict: "uncertain", notAnAttempt: true, reasons: ["scripted"] });

/** An evaluator driven by a table of text → evaluation. Unknown text is uncertain. Counts calls. */
export function scripted(table: Record<string, Evaluation>) {
  const calls: { item: EvaluatorItem; input: EvaluationInput }[] = [];
  const fn = (item: EvaluatorItem, input: EvaluationInput): Evaluation => {
    calls.push({ item, input });
    return table[input.text.trim()] ?? UNSURE;
  };
  return Object.assign(fn, { calls });
}

export function runner(options: { evaluate?: CycleContext["evaluate"]; aiAvailable?: boolean; seenItemIds?: readonly string[] } = {}) {
  const next = clock();
  let session: GuidedSession = createGuidedSession("s1", T0);
  const log: CycleResult[] = [];
  const api = {
    get session() {
      return session;
    },
    set(s: GuidedSession) {
      session = s;
    },
    send(event: CycleEvent, over: Partial<CycleContext> = {}): CycleResult {
      const r = reduce(session, event, { now: next(), ...options, ...over });
      session = r.session;
      log.push(r);
      return r;
    },
    /** Type and submit one answer. */
    answer(text: string, over: Partial<CycleContext> = {}): CycleResult {
      api.send({ type: "EDIT", draft: text });
      return api.send({ type: "SUBMIT" }, over);
    },
    get ex() {
      return session.exercises[session.exercises.length - 1];
    },
    log,
  };
  return api;
}
