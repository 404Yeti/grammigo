import type { TargetCategory, Verdict } from "../types";

export type ItemKey = "main" | "transferFinished" | "transferUnfinished" | "experience";
export const ITEM_ID: Record<ItemKey, string> = {
  main: "ppps-main",
  transferFinished: "ppps-transfer-finished",
  transferUnfinished: "ppps-transfer-unfinished",
  experience: "ppps-experience",
};

export interface Case {
  item: ItemKey;
  source: "typed" | "spoken";
  text: string;
  /** What a careful teacher would conclude. `uncertain` = genuinely ambiguous, or nothing to judge. */
  expect: Verdict;
  /** For `incorrect`: the main target error. */
  category?: TargetCategory;
  tags: string[];
}

type Maker = (text: string, ...tags: string[]) => Case;

/** Cases for one item. `typed` and `spoken` are separate makers so the source is explicit in the corpus. */
export function forItem(item: ItemKey) {
  const make = (source: Case["source"], expect: Verdict, category?: TargetCategory) => (text: string, ...tags: string[]): Case => ({ item, source, text, expect, category, tags });
  const ok = (source: Case["source"]): Maker => make(source, "correct");
  const maybe = (source: Case["source"]): Maker => make(source, "uncertain");
  const wrong = (source: Case["source"], category: TargetCategory): Maker => make(source, "incorrect", category);
  return {
    ok: ok("typed"), okSpoken: ok("spoken"),
    maybe: maybe("typed"), maybeSpoken: maybe("spoken"),
    wrong: (category: TargetCategory, text: string, ...tags: string[]) => wrong("typed", category)(text, ...tags),
    wrongSpoken: (category: TargetCategory, text: string, ...tags: string[]) => wrong("spoken", category)(text, ...tags),
  };
}
