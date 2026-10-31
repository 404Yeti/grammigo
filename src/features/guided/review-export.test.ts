import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDED_PILOT, renderLadder } from "@/curriculum/guided";
import { DEV } from "./evaluator/corpus/dev";
import { HOLDOUT } from "./evaluator/corpus/holdout";
import { HOLDOUT2 } from "./evaluator/corpus/holdout2";
import { HOLDOUT3 } from "./evaluator/corpus/holdout3";
import { ITEM_ID } from "./evaluator/corpus/helpers";
import { runCorpus } from "./evaluator/score";
import { NEUTRAL, VOICE_MESSAGES } from "./cycle/messages";

/**
 * Educator-review artifacts (docs/guided-correction/). Regenerate with:  GUIDED_REVIEW_EXPORT=1 npx vitest run src/features/guided/review-export.test.ts
 * Everything exported is PROVISIONAL and must be reviewed by an educator before any public release.
 */
const DIR = join(process.cwd(), "docs/guided-correction");
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
const SETS = [["dev", DEV], ["holdout-1", HOLDOUT], ["holdout-2", HOLDOUT2], ["holdout-3-unseen", HOLDOUT3]] as const;

function labels() {
  const rows: (string | number)[][] = [["set", "item_id", "source", "sentence", "label_expected_verdict", "label_category", "tags", "evaluator_verdict_v1.0.0", "evaluator_category", "reviewer_verdict (agree/disagree/unsure)", "reviewer_corrected_label", "reviewer_notes"]];
  for (const [name, cases] of SETS)
    for (const s of runCorpus(cases)) rows.push([name, ITEM_ID[s.case.item], s.case.source, s.case.text, s.case.expect, s.case.category ?? "", s.case.tags.join("|"), s.got.verdict, s.got.category ?? "", "", "", ""]);
  return rows;
}

function explanations() {
  const rows: (string | number)[][] = [["kind", "id", "field", "text", "reviewer_verdict (approve/revise/reject)", "reviewer_revised_text", "reviewer_notes"]];
  const add = (kind: string, id: string, field: string, text: string) => rows.push([kind, id, field, text, "", "", ""]);
  for (const i of GUIDED_PILOT.items) {
    add("item", i.id, "situation", i.situation);
    add("item", i.id, "question", i.question);
    add("item", i.id, "answer_hint", i.answerHint);
    i.modelAnswers.forEach((m, n) => add("item", i.id, `model_answer_${n + 1}`, m));
  }
  for (const c of GUIDED_PILOT.categories) {
    const l = renderLadder(c.id, { marker: "{marker}", aux: "{aux}", verb: "{verb}" });
    add("category", c.id, "label", c.label);
    add("category", c.id, "notice (rung 1)", c.notice);
    add("category", c.id, "hint2 (rung 2)", c.hint2);
    add("category", c.id, "hint3 (rung 3)", c.hint3);
    add("category", c.id, "reason (understand)", c.reason);
    add("category", c.id, "rendered_with_placeholders", JSON.stringify(l));
  }
  for (const [k, v] of Object.entries(NEUTRAL)) {
    if (typeof v === "string") add("neutral", k, "text", v);
    else for (const [kk, vv] of Object.entries(v)) add("neutral", `${k}.${kk}`, "text", vv);
  }
  for (const [k, v] of Object.entries(VOICE_MESSAGES)) add("voice", k, "text", v);
  return rows;
}

describe("educator-review export", () => {
  it.runIf(process.env.GUIDED_REVIEW_EXPORT === "1")("regenerates the review files", () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, "labels-for-review.csv"), csv(labels()));
    writeFileSync(join(DIR, "explanations-for-review.csv"), csv(explanations()));
  });

  it("the committed files are in step with the corpus and the authored content", () => {
    const lf = join(DIR, "labels-for-review.csv");
    const ef = join(DIR, "explanations-for-review.csv");
    expect(existsSync(lf) && existsSync(ef), "run with GUIDED_REVIEW_EXPORT=1 to generate").toBe(true);
    expect(readFileSync(lf, "utf8")).toBe(csv(labels()));
    expect(readFileSync(ef, "utf8")).toBe(csv(explanations()));
  });
});
