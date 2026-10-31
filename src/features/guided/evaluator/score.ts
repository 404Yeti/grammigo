import { GUIDED_PILOT } from "@/curriculum/guided";
import { evaluate } from "./evaluate";
import { ITEM_ID, type Case } from "./corpus/helpers";
import type { Evaluation, EvaluatorItem } from "./types";

export const evaluatorItem = (id: string): EvaluatorItem => {
  const i = GUIDED_PILOT.items.find((x) => x.id === id);
  if (!i) throw new Error(`no pilot item ${id}`);
  return { id: i.id, frame: i.frame, categories: i.categories };
};

export interface Scored {
  case: Case;
  got: Evaluation;
}

export const runCorpus = (cases: readonly Case[]): Scored[] =>
  cases.map((c) => ({ case: c, got: evaluate(evaluatorItem(ITEM_ID[c.item]), { text: c.text, source: c.source }) }));

const show = (s: Scored) => `[${s.case.item}/${s.case.source}] “${s.case.text.length > 70 ? s.case.text.slice(0, 70) + "…" : s.case.text}” expected ${s.case.expect}${s.case.category ? `(${s.case.category})` : ""} got ${s.got.verdict}${s.got.category ? `(${s.got.category})` : ""} [${s.got.reasons.join(",")}]`;

export function summarize(scored: Scored[]) {
  const of = (e: string) => scored.filter((s) => s.case.expect === e);
  const expectedIncorrect = of("incorrect");
  const expectedCorrect = of("correct");
  const expectedUncertain = of("uncertain");

  const falseWrong = scored.filter((s) => s.got.verdict === "incorrect" && s.case.expect !== "incorrect");
  const falseWrongOnValid = falseWrong.filter((s) => s.case.expect === "correct");
  const falseWrongOnAmbiguous = falseWrong.filter((s) => s.case.expect === "uncertain");
  const detected = expectedIncorrect.filter((s) => s.got.verdict === "incorrect");
  const missedErrors = expectedIncorrect.filter((s) => s.got.verdict === "uncertain");
  const falseRight = expectedIncorrect.filter((s) => s.got.verdict === "correct");
  const wrongCategory = detected.filter((s) => s.got.category !== s.case.category);

  const recognised = expectedCorrect.filter((s) => s.got.verdict === "correct");
  const correctMissed = expectedCorrect.filter((s) => s.got.verdict === "uncertain");
  const altTags = ["valid_alternative", "natural_short_answer", "short_answer", "natural_spoken"];
  const alternatives = expectedCorrect.filter((s) => s.case.tags.some((t) => altTags.includes(t)));
  const alternativesAccepted = alternatives.filter((s) => s.got.verdict === "correct");

  const unrelated = scored.filter((s) => s.case.tags.includes("unrelated_error"));
  const unrelatedIgnored = unrelated.filter((s) => s.got.verdict !== "incorrect");

  const uncertainAsExpected = expectedUncertain.filter((s) => s.got.verdict === "uncertain");
  const uncertainButCorrect = expectedUncertain.filter((s) => s.got.verdict === "correct");

  const spoken = scored.filter((s) => s.case.source === "spoken");
  return {
    totals: { cases: scored.length, expectedCorrect: expectedCorrect.length, expectedIncorrect: expectedIncorrect.length, expectedUncertain: expectedUncertain.length, spoken: spoken.length },
    falseWrong: { total: falseWrong.length, onValid: falseWrongOnValid.length, onAmbiguous: falseWrongOnAmbiguous.length, list: falseWrong.map(show) },
    errors: {
      detected: detected.length, missedToUncertain: missedErrors.length, acceptedAsCorrect: falseRight.length, wrongCategory: wrongCategory.length,
      recall: expectedIncorrect.length ? detected.length / expectedIncorrect.length : 1,
      missedList: missedErrors.map(show), acceptedList: falseRight.map(show), wrongCategoryList: wrongCategory.map(show),
    },
    valid: {
      recognised: recognised.length, missedToUncertain: correctMissed.length, recognisedRate: expectedCorrect.length ? recognised.length / expectedCorrect.length : 1,
      alternatives: alternatives.length, alternativesAccepted: alternativesAccepted.length, missedList: correctMissed.map(show),
    },
    unrelatedErrors: { cases: unrelated.length, ignored: unrelatedIgnored.length },
    ambiguous: { asExpected: uncertainAsExpected.length, lenientlyCorrect: uncertainButCorrect.length, lenientList: uncertainButCorrect.map(show) },
    uncertainRate: { overall: scored.filter((s) => s.got.verdict === "uncertain").length / scored.length, onValidAnswers: expectedCorrect.length ? correctMissed.length / expectedCorrect.length : 0 },
    spoken: { cases: spoken.length, falseWrong: spoken.filter((s) => s.got.verdict === "incorrect" && s.case.expect !== "incorrect").length },
  };
}
