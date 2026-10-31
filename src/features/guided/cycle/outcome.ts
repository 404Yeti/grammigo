import type { GuidedOutcomeKind, GuidedSession, GuidedState } from "@/types/guided";

/**
 * Provisional activity weights. They are NOT mastery values: nothing in mastery, the learning
 * profile or recommendations reads them, and they say nothing about a learner's level until their
 * educational meaning has been validated. `unverified` has no value and no penalty.
 */
export const GUIDED_OUTCOME_VALUES: Readonly<Record<Exclude<GuidedOutcomeKind, "unverified">, number>> = {
  first_try: 1.0,
  self_corrected: 0.7,
  hint_assisted: 0.5,
  shown: 0,
};

export const outcomeValue = (kind: GuidedOutcomeKind): number | null => (kind === "unverified" ? null : GUIDED_OUTCOME_VALUES[kind]);

export interface OutcomeRecord {
  sessionId: string;
  exerciseId: string;
  itemId: string;
  exerciseKind: "main" | "transfer";
  outcome: GuidedOutcomeKind;
  basis: "deterministic" | "ai_second_opinion" | "none";
  source: "typed" | "spoken" | null;
  /** The provisional value, or null when the outcome carries none. */
  value: number | null;
  at: number;
}

const OUTCOME_KINDS: GuidedOutcomeKind[] = ["first_try", "self_corrected", "hint_assisted", "shown", "unverified"];

export function outcomeRecords(sessions: readonly GuidedSession[]): OutcomeRecord[] {
  return sessions.flatMap((s) =>
    s.exercises.flatMap((e) =>
      e.outcome
        ? [{ sessionId: s.id, exerciseId: e.id, itemId: e.itemId, exerciseKind: e.kind, outcome: e.outcome.kind, basis: e.outcome.basis, source: e.outcome.source, value: outcomeValue(e.outcome.kind), at: e.outcome.at }]
        : [],
    ),
  );
}

const zero = (): Record<GuidedOutcomeKind, number> => ({ first_try: 0, self_corrected: 0, hint_assisted: 0, shown: 0, unverified: 0 });

export interface OutcomeSummary {
  main: Record<GuidedOutcomeKind, number>;
  transfer: Record<GuidedOutcomeKind, number>;
  spoken: number;
  typed: number;
  /** Outcomes the AI helped confirm. Reported, never required. */
  aiConfirmed: number;
  /** Mean of the provisional values over valued outcomes only; null when there are none. Informational. */
  meanProvisionalValue: number | null;
}

/** Reads ONLY guided history. Deliberately takes a GuidedState, never the learner's lesson state. */
export function summarizeOutcomes(state: Pick<GuidedState, "sessions">): OutcomeSummary {
  const records = outcomeRecords(state.sessions);
  const main = zero();
  const transfer = zero();
  for (const r of records) (r.exerciseKind === "main" ? main : transfer)[r.outcome]++;
  const valued = records.filter((r) => r.value !== null);
  return {
    main,
    transfer,
    spoken: records.filter((r) => r.source === "spoken").length,
    typed: records.filter((r) => r.source === "typed").length,
    aiConfirmed: records.filter((r) => r.basis === "ai_second_opinion").length,
    meanProvisionalValue: valued.length ? valued.reduce((a, r) => a + (r.value as number), 0) / valued.length : null,
  };
}

export { OUTCOME_KINDS };
