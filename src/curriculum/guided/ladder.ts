import { EXAMPLE_VERBS, WRONG_PARTICIPLE } from "@/features/guided/evaluator/lexicon";
import type { TargetCategory } from "@/features/guided/evaluator/types";
import { getGuidedCategory } from "./pilot";

export interface LadderContext {
  /** The learner's own time expression, auxiliary and verb, as found by the evaluator. */
  marker?: string | null;
  aux?: string | null;
  verb?: string | null;
}

export interface Ladder {
  notice: string;
  hint2: string;
  hint3: string;
  reason: string;
}

const FALLBACK = { marker: "the time expression", aux: "have", verb: "that verb" };

/** A stock verb for rung-3 examples that is never the learner's own verb, so the example can't give the answer away. */
function exampleFor(verb: string | null | undefined) {
  return EXAMPLE_VERBS.find((e) => e.base !== verb && e.past !== verb && e.participle !== verb) ?? EXAMPLE_VERBS[0];
}

export function renderLadder(category: TargetCategory, ctx: LadderContext = {}): Ladder {
  const c = getGuidedCategory(category);
  if (!c) throw new Error(`Unknown guided category: ${category}`);
  const ex = exampleFor(ctx.verb);
  const vars: Record<string, string> = {
    marker: ctx.marker || FALLBACK.marker,
    aux: ctx.aux || FALLBACK.aux,
    verb: ctx.verb || FALLBACK.verb,
    participle: (ctx.verb && WRONG_PARTICIPLE.get(ctx.verb)) || "the participle",
    exBase: ex.base,
    exPast: ex.past,
    exPart: ex.participle,
  };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  return { notice: fill(c.notice), hint2: fill(c.hint2), hint3: fill(c.hint3), reason: fill(c.reason) };
}
