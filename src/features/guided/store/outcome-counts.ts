import type { GuidedOutcomeKind, GuidedState } from "@/types/guided";

/**
 * How many Guided Correction exercises ended each way. Plain COUNTS of activity, nothing else: no weights, no totals scored, no
 * percentages, no level. They are not mastery and never feed it (the learning code cannot import this folder; see separation.test.ts).
 */
export type OutcomeCounts = Record<GuidedOutcomeKind, number>;

export function countOutcomes(state: GuidedState): OutcomeCounts {
  const counts: OutcomeCounts = { first_try: 0, self_corrected: 0, hint_assisted: 0, shown: 0, unverified: 0 };
  for (const session of state.sessions) {
    for (const exercise of session.exercises) if (exercise.outcome) counts[exercise.outcome.kind] += 1;
  }
  return counts;
}

export const hasActivity = (c: OutcomeCounts) => Object.values(c).some((n) => n > 0);
