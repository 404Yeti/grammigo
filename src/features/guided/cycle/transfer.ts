import { GUIDED_PILOT } from "@/curriculum/guided";
import type { GuidedOutcomeKind } from "@/types/guided";

/**
 * Chooses the "new situation" exercise. Pure; the app asks, the evaluator never decides.
 *
 *  - Same direction after a mistake, a shown answer, or an unverified answer: more evidence where it is needed.
 *  - The opposite direction after a first-try success: does the learner choose the tense rather than repeat a rule?
 *  - Prefer an item not yet seen; fall back to the alternate, then to the preferred item again.
 */
export function pickTransfer(input: { mainItemId: string; mainOutcome: GuidedOutcomeKind; seen: readonly string[] }): string {
  const plan = GUIDED_PILOT.transferPlan;
  const preferred = input.mainOutcome === "first_try" ? plan.afterFirstTry : plan.afterError;
  const others = input.mainOutcome === "first_try" ? [...plan.afterError, ...plan.alternate] : [...plan.afterFirstTry, ...plan.alternate];
  const usable = (id: string) => id !== input.mainItemId;
  const unseen = (id: string) => !input.seen.includes(id);
  return (
    preferred.find((id) => usable(id) && unseen(id)) ??
    others.find((id) => usable(id) && unseen(id)) ??
    preferred.find(usable) ??
    others.find(usable) ??
    preferred[0]
  );
}
