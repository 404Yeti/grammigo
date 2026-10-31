import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDED_PILOT, renderLadder } from "@/curriculum/guided";
import { DEV } from "./evaluator/corpus/dev";
import { HOLDOUT } from "./evaluator/corpus/holdout";
import { HOLDOUT2 } from "./evaluator/corpus/holdout2";
import { HOLDOUT3 } from "./evaluator/corpus/holdout3";
import { HOLDOUT4 } from "./evaluator/corpus/holdout4";
import { ITEM_ID } from "./evaluator/corpus/helpers";
import { runCorpus } from "./evaluator/score";
import { NEUTRAL, VOICE_MESSAGES } from "./cycle/messages";
import { CONTRAST, COPY, OUTCOME_LABEL, RESOLVED } from "./ui/copy";
import { OPEN_REVIEW_ITEMS } from "./release";

/**
 * Educator-review artifacts (docs/guided-correction/). Regenerate with:  GUIDED_REVIEW_EXPORT=1 npx vitest run src/features/guided/review-export.test.ts
 * Everything exported is PROVISIONAL and must be reviewed by an educator before any public release.
 */
const DIR = join(process.cwd(), "docs/guided-correction");
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
const SETS = [["dev", DEV], ["holdout-1", HOLDOUT], ["holdout-2", HOLDOUT2], ["holdout-3-seen", HOLDOUT3], ["holdout-4-unseen", HOLDOUT4]] as const;

/** The AI second opinion's behaviour on each uncertain sentence (live run, docs/guided-correction/live-ai-corpus.json). */
function aiRows(): Record<string, { fit: string | null; decision: string; label: string }> {
  const f = join(DIR, "live-ai-corpus.json");
  if (!existsSync(f)) return {};
  const rows = JSON.parse(readFileSync(f, "utf8")).rows as { text: string; fit: string | null; decision: string; label: string }[];
  return Object.fromEntries(rows.map((r) => [r.text, r]));
}

/** Known label problems found while preparing the review (labels are left as written; the educator rules). */
const LABEL_NOTES: Record<string, string> = {
  "I have swum in the sea twice this month.": "AUTHOR LABEL ERROR: “swum” is the correct participle, so this sentence is valid, not a participle error.",
};

interface Risk {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
}

function riskOf(c: { expect: string; tags: string[]; text: string }, matches: boolean, ai: ReturnType<typeof aiRows>[string] | undefined): Risk {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };
  if (!matches) add(5, "evaluator disagrees with the label");
  if (OPEN_REVIEW_ITEMS.some((i) => i.sentence === c.text)) add(4, "open review item");
  if (c.tags.some((t) => /both_errors|multi/.test(t))) add(4, "two errors in one sentence (which is shown first?)");
  if (LABEL_NOTES[c.text]) add(5, "known label problem");
  if (ai && ((ai.label === "correct" && ai.decision !== "accept_fit") || (ai.label === "incorrect" && ai.decision === "accept_fit") || (ai.label === "uncertain" && ai.decision === "accept_fit"))) add(3, "the AI second opinion disagrees with the label");
  if (c.expect === "incorrect") add(2, "a correction would be shown to learners (a wrong label means a false correction)");
  if (c.expect === "uncertain") add(2, "labelled ambiguous: is it really ambiguous?");
  if (c.tags.some((t) => /since_clause_valid|for_clause_valid|hard|valid_alternative/.test(t))) add(1, "valid alternative in a tricky structure");
  return { score, level: score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW", reasons };
}

function labels() {
  const ai = aiRows();
  const body: { score: number; row: (string | number)[] }[] = [];
  for (const [name, cases] of SETS)
    for (const s of runCorpus(cases)) {
      const open = OPEN_REVIEW_ITEMS.find((i) => i.sentence === s.case.text);
      const matches = s.got.verdict === s.case.expect && (s.case.expect !== "incorrect" || s.got.category === s.case.category);
      const risk = riskOf({ expect: s.case.expect, tags: s.case.tags, text: s.case.text }, matches, ai[s.case.text]);
      const flag = [open ? `REVIEW FIRST (${open.kind}, ${open.status}): ${open.question}` : "", LABEL_NOTES[s.case.text] ?? ""].filter(Boolean).join(" | ");
      body.push({ score: risk.score, row: [risk.level, risk.reasons.join("; "), name, ITEM_ID[s.case.item], s.case.source, s.case.text, s.case.expect, s.case.category ?? "", s.case.tags.join("|"), s.got.verdict, s.got.category ?? "", matches ? "yes" : "NO", flag, "", "", ""] });
    }
  body.sort((a, b) => b.score - a.score); // stable: the riskiest labels come first
  const head = ["review_priority", "why_this_priority", "set", "item_id", "source", "sentence", "label_expected_verdict", "label_category", "tags", "evaluator_verdict_v1.1.0", "evaluator_category", "evaluator_matches_label", "flag", "reviewer_verdict (agree/disagree/unsure)", "reviewer_corrected_label", "reviewer_notes"];
  return [head, ...body.map((b) => b.row)];
}

/** Why specific authored wording is high-risk. Everything else gets a default level for its kind. */
const CONTENT_RISK: Record<string, string> = {
  "category:since_for_confusion:notice (rung 1)": "“time expression” fits “for 2018” but not a clause (“for I was a child”), which evaluator 1.1.0 now flags.",
  "category:since_for_confusion:reason (understand)": "“Both go with the present perfect” is not true as a general rule (“I lived there for three years”). True only for this question.",
  "category:pp_with_finished_time:notice (rung 1)": "When corrective guidance comes from the AI path there is no learner time word, so the placeholder reads “the time expression”. Awkward wording a learner will see.",
  "item:ppps-experience:model_answer_1": "The model answer is a past simple answer, while the explanation for this frame says experience goes with the present perfect. Is accepting both the intended teaching?",
  "item:ppps-experience:question": "Both tenses are accepted as correct here. Does an answer in either tense really test the target skill?",
  "item:ppps-transfer-unfinished:question": "A past simple answer with a finished marker (“I started in 2020”) is accepted as correct. Is that the intended standard?",
  "outcome_message:first_try.body": "“Your tenses match what the question asks.” may over-claim: the on-device check judges only the target skill, not the whole sentence.",
};

function contentRisk(kind: string, id: string, field: string): { level: "HIGH" | "MEDIUM" | "LOW"; why: string } {
  const key = `${kind}:${id}:${field}`;
  if (CONTENT_RISK[key]) return { level: "HIGH", why: CONTENT_RISK[key] };
  if (kind === "category") return { level: "MEDIUM", why: "hint and reason wording teaches a rule directly: check accuracy, level and that rungs 1–2 do not give the answer away" };
  if (kind === "contrast_example") return { level: "MEDIUM", why: "new in Phase 4: two correct sentences meant to clarify the rule; check they genuinely help" };
  if (kind === "outcome_message") return { level: "MEDIUM", why: "feedback shown right after an answer; tone and claims matter" };
  return { level: "LOW", why: "" };
}

function explanations() {
  const rows: (string | number)[][] = [];
  const add = (kind: string, id: string, field: string, text: string) => {
    const r = contentRisk(kind, id, field);
    rows.push([r.level, r.why, kind, id, field, text, "", "", ""]);
  };
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
  const walk = (kind: string, prefix: string, v: unknown) => {
    if (typeof v === "string") add(kind, prefix, "text", v);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(kind, `${prefix}[${i}]`, x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(kind, prefix ? `${prefix}.${k}` : k, x);
  };
  walk("screen", "", COPY);
  walk("outcome_label", "", OUTCOME_LABEL);
  walk("outcome_message", "", RESOLVED);
  walk("contrast_example", "", CONTRAST);
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  rows.sort((a, b) => order[a[0] as keyof typeof order] - order[b[0] as keyof typeof order]);
  return [["review_priority", "why_this_priority", "kind", "id", "field", "text", "reviewer_verdict (approve/revise/reject)", "reviewer_revised_text", "reviewer_notes"], ...rows];
}

/** One page for the reviewer: where to start. Generated, so it cannot drift from the data. */
function priorityMd(): string {
  const l = labels().slice(1);
  const e = explanations().slice(1);
  const high = l.filter((r) => r[0] === "HIGH");
  const med = l.filter((r) => r[0] === "MEDIUM").length;
  const twoError = l.filter((r) => /both_errors|multi/.test(String(r[8])));
  const multi = { tenseFirst: twoError.filter((r) => r[7] === "pp_with_finished_time").length, verbFirst: twoError.filter((r) => r[7] === "participle_form").length };
  const cell = (r: (string | number)[], i: number) => String(r[i]).replace(/\|/g, "/");
  const lines = [
    "# Educator review: start here",
    "",
    "> PROVISIONAL. Nothing here is validated. Generated by `review-export.test.ts`; do not edit by hand.",
    "",
    `Labelled sentences: ${l.length} (${high.length} high priority, ${med} medium). Authored wording: ${e.length} lines (${e.filter((r) => r[0] === "HIGH").length} high, ${e.filter((r) => r[0] === "MEDIUM").length} medium).`,
    "The CSV files are sorted so the riskiest rows are first.",
    "",
    "## 1. Highest-risk authored wording (what learners will read)",
    "",
    "| Where | Text | Concern |",
    "|---|---|---|",
    ...e.filter((r) => r[0] === "HIGH").map((r) => `| ${cell(r, 2)} · ${cell(r, 3)} · ${cell(r, 4)} | ${cell(r, 5)} | ${cell(r, 1)} |`),
    "",
    "## 2. Highest-risk labels (a wrong label here means a wrong correction, or a missed one)",
    "",
    "| Set | Sentence | Label | Evaluator | Why |",
    "|---|---|---|---|---|",
    ...high.map((r) => `| ${cell(r, 2)} | ${cell(r, 5)} | ${cell(r, 6)}${r[7] ? "/" + cell(r, 7) : ""} | ${cell(r, 9)}${r[10] ? "/" + cell(r, 10) : ""} | ${cell(r, 1)} |`),
    "",
    "## 3. Questions only an educator can answer",
    "",
    `1. Two errors in one sentence: which should the learner be shown first? ${multi.tenseFirst} such sentences are labelled tense-first (what the evaluator does); ${multi.verbFirst} are labelled verb-form-first (they include the three open cases, which are deliberately NOT relabelled; the rest may simply be two participle errors). One ruling on the principle settles all of them.`,
    "2. Should the experience question accept a past simple answer as fully correct?",
    "3. Is “since + clause” / “for + clause” wrong at this level, or only unusual?",
    "4. Do the hint ladders and the new contrast examples teach the rule accurately and at the right level?",
    "5. Are the labelled-ambiguous sentences really ambiguous?",
    "",
  ];
  return lines.join("\n");
}

describe("educator-review export", () => {
  it.runIf(process.env.GUIDED_REVIEW_EXPORT === "1")("regenerates the review files", () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, "labels-for-review.csv"), csv(labels()));
    writeFileSync(join(DIR, "explanations-for-review.csv"), csv(explanations()));
    writeFileSync(join(DIR, "educator-review-priority.md"), priorityMd());
  });

  it("the committed files are in step with the corpus and the authored content", () => {
    const lf = join(DIR, "labels-for-review.csv");
    const ef = join(DIR, "explanations-for-review.csv");
    expect(existsSync(lf) && existsSync(ef), "run with GUIDED_REVIEW_EXPORT=1 to generate").toBe(true);
    expect(readFileSync(lf, "utf8")).toBe(csv(labels()));
    expect(readFileSync(ef, "utf8")).toBe(csv(explanations()));
    expect(readFileSync(join(DIR, "educator-review-priority.md"), "utf8")).toBe(priorityMd());
  });
});
