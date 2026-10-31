import { z } from "zod";
import { TARGET_CATEGORIES, type Suspected, type TargetCategory } from "@/features/guided/evaluator/types";
import type { ClarifyKind, StoredOpinion } from "@/types/guided";
import { GUIDED_LIMITS } from "./config";

/**
 * The AI's second opinion on an answer the deterministic check could not judge.
 *
 * What it may do: say whether the answer fits the question and the target skill, and tell an
 * answer that is merely incomplete or off-topic apart from one with a possible grammar concern.
 * What it may NOT do, by construction: there is no output of this module that records an answer
 * as incorrect, and nothing here writes a score. A "grammar_concern" only leads to an ungraded,
 * optional clarification. The only outcome the AI can help create is a success ("fits").
 *
 * The raw model output is validated here before anything uses it; anything malformed is a failure.
 */
export const opinionSchema = z
  .object({
    fit: z.enum(["fits", "off_prompt", "incomplete", "grammar_concern", "unclear"]),
    confidence: z.enum(["low", "medium", "high"]),
    suspected: z.enum(TARGET_CATEGORIES).nullable().optional(),
  })
  .strict();

export type OpinionFailure = "unavailable" | "timeout" | "rate_limited" | "invalid" | "offline";
export type OpinionResult = { status: "ok"; opinion: StoredOpinion } | { status: "failed"; reason: OpinionFailure };

export function parseOpinion(raw: unknown): OpinionResult {
  const parsed = opinionSchema.safeParse(raw);
  if (!parsed.success) return { status: "failed", reason: "invalid" };
  return { status: "ok", opinion: { fit: parsed.data.fit, confidence: parsed.data.confidence, suspected: parsed.data.suspected ?? null } };
}

export type OpinionDecision =
  /** A success the AI helped confirm (high confidence only). */
  | { action: "accept_fit" }
  /** Ungraded guidance. The learner may answer again; nothing is recorded against them. */
  | { action: "clarify"; kind: ClarifyKind; suspected: TargetCategory | null }
  /** Could not be judged. Neutral explanation; the learner moves on without a penalty. */
  | { action: "unverified"; reason: string };

/**
 * What the deterministic evaluator must have suspected for the AI's suspected category to count as corroborated.
 * Corrective grammar guidance needs BOTH signals; the AI alone is never enough (owner decision, Phase 5).
 */
export const CORROBORATION: Readonly<Record<TargetCategory, readonly Suspected[]>> = {
  pp_with_finished_time: ["pp_with_finished_time", "pp_without_marker"],
  since_without_perfect: ["since_without_perfect", "past_simple_for_ongoing", "present_with_for"],
  since_for_confusion: ["since_for_confusion"],
  participle_form: ["participle_form"],
};

export const isCorroborated = (ai: TargetCategory | null, evaluator: Suspected | null | undefined): boolean => !!ai && !!evaluator && CORROBORATION[ai].includes(evaluator);

export function decideOnOpinion(
  opinion: StoredOpinion,
  ctx: { clarificationsUsed: number; itemCategories: readonly string[]; /** What the on-device check suspected for the same answer. */ evaluatorSuspected?: Suspected | null },
): OpinionDecision {
  const canClarify = ctx.clarificationsUsed < GUIDED_LIMITS.maxClarifications;
  const suspected = opinion.suspected && ctx.itemCategories.includes(opinion.suspected) ? opinion.suspected : null;

  switch (opinion.fit) {
    case "fits":
      return opinion.confidence === "high" ? { action: "accept_fit" } : { action: "unverified", reason: "fit_not_confident" };
    case "incomplete":
    case "off_prompt":
      if (opinion.confidence === "low") return { action: "unverified", reason: "low_confidence" };
      return canClarify ? { action: "clarify", kind: opinion.fit, suspected: null } : { action: "unverified", reason: "clarification_used" };
    case "grammar_concern":
      // A concern is guidance, never a verdict, whatever the confidence, and it is only shown when the on-device
      // check independently suspected the same thing. An uncorroborated concern leaves the answer unverified, with no guidance.
      if (opinion.confidence === "low") return { action: "unverified", reason: "low_confidence" };
      if (!isCorroborated(suspected, ctx.evaluatorSuspected)) return { action: "unverified", reason: "concern_not_corroborated" };
      return canClarify ? { action: "clarify", kind: "grammar_guidance", suspected } : { action: "unverified", reason: "clarification_used" };
    case "unclear":
      return { action: "unverified", reason: "unclear" };
  }
}
