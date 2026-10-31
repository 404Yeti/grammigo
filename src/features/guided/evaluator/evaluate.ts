import { analyze, type Features } from "./analyze";
import { NUMBER_WORDS, UNITS, MONTHS, WEEKDAYS } from "./lexicon";
import { normalizeInput } from "./normalize";
import type { Evaluation, EvaluationInput, EvaluatorItem, Suspected, TargetCategory } from "./types";

/**
 * Deterministic, offline checker for the Past simple vs Present perfect pilot.
 *
 * Principles (in priority order):
 *  1. Never a false "incorrect". `incorrect` needs an explicit, listed target-skill pattern.
 *  2. Anything unclear is `uncertain`, with a suspected category. It is never counted against the learner.
 *  3. Only the target skill is judged. Spelling, articles, prepositions, word choice and other grammar are ignored.
 *  4. Natural spoken answers are accepted: short answers, fragments, contractions, fillers, self-repairs.
 */

export const MAX_TEXT_LENGTH = 300;

const COMMON_ENGLISH = new Set([
  "the", "a", "an", "i", "you", "he", "she", "it", "we", "they", "my", "your", "to", "and", "in", "on", "at", "of", "for",
  "with", "was", "were", "is", "am", "are", "have", "has", "had", "did", "do", "does", "no", "yes", "not", "never", "all",
  "about", "since", "ago", "last", "yesterday", "just", "that", "this", "then", "so", "but", "because", "when", "after",
  "before", "me", "him", "her", "us", "them", "our", "some", "one", "two", "three", "years", "year", "months", "week",
  "while", "long", "time", "life", "ages", "once", "ever", "yeah", "yep", "nope", "sure", "course", "really", "not",
]);

const blank = (): Evaluation => ({
  verdict: "uncertain", category: null, validAlternative: false, suspected: null, notAnAttempt: false,
  reasons: [], marker: null, aux: null, verb: null,
});

const uncertain = (reasons: string[], opts: Partial<Pick<Evaluation, "suspected" | "notAnAttempt" | "marker" | "aux" | "verb">> = {}): Evaluation => ({ ...blank(), reasons, ...opts });
const correct = (reasons: string[], validAlternative: boolean): Evaluation => ({ ...blank(), verdict: "correct", validAlternative, reasons });

const FRAGMENT_ABOUT = "(?:about |around |almost |nearly |over |more than |just over |roughly |a little over )?";
const UNFINISHED_FRAGMENTS: RegExp[] = [
  new RegExp(`^${FRAGMENT_ABOUT}(?:for )?${FRAGMENT_ABOUT}${NUMBER_WORDS} (?:and a half )?${UNITS}(?: now| already| or so)?$`),
  /^since (?:19|20)\d\d$/,
  new RegExp(`^since (?:last )?(?:${MONTHS}|${WEEKDAYS}|week|month|year|summer|winter)$`),
  /^since (?:my )?(?:childhood|school|high school|primary school|secondary school|university|college|kindergarten|birth|then)$/,
  /^since i was (?:a |an )?\w+(?: \w+)?$/,
  /^since (?:i|we) (?:came|arrived|moved|started|began|left|joined|graduated|got here)(?: \w+){0,4}$/,
  /^(?:all my life|my whole life|my entire life|forever|ages|for ages|a long time|for a long time|quite a while|a while|for a while|a few years|a couple of years|not long|not very long|a short time|years|for years|months|for months)$/,
];

const cleaned = (s: string) => s.replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
/** "Maybe two years", "I think about five years": hedges in front of a short answer. */
const withoutHedges = (s: string) =>
  s
    .replace(/^(?:(?:maybe|probably|perhaps|i think|i guess|like|well|so|only|just)\s+)+/, "")
    .replace(/(?:\s+(?:really|i think|i guess|or so|maybe|now|already|honestly|probably))+$/, "");

function targetError(item: EvaluatorItem, f: Features): Evaluation | null {
  const on = (c: TargetCategory) => item.categories.includes(c);

  // 1. since / for used with the wrong kind of time expression (checked first: it is the more specific diagnosis).
  if (on("since_for_confusion") && (f.sinceDuration || f.forPoint)) {
    return { ...blank(), verdict: "incorrect", category: "since_for_confusion", reasons: [f.sinceDuration ? "since_with_duration" : "for_with_point"] };
  }
  // 2. Present perfect (even with a wrong participle) together with a finished-time expression in the same clause.
  //    Tense choice comes before verb form: it is the first thing to fix.
  if (on("pp_with_finished_time")) {
    const verbs = [...f.past, ...f.perfect, ...f.wrongParticiple, ...f.ambiguousPerfect];
    for (const p of [...f.perfect, ...f.wrongParticiple]) {
      for (const m of f.markers.filter((x) => x.sentence === p.sentence && x.clause === p.clause)) {
        // The time word belongs to the nearest verb. If another verb is as near or nearer ("the book you gave me yesterday"),
        // it is not the present perfect's time word, so this is not a verdict.
        const d = Math.abs(m.index - p.index);
        const attachedElsewhere = verbs.some((h) => h !== p && h.sentence === p.sentence && h.clause === p.clause && Math.abs(m.index - h.index) <= d);
        if (attachedElsewhere) continue;
        return { ...blank(), verdict: "incorrect", category: "pp_with_finished_time", reasons: ["perfect_with_finished_marker"], marker: m.text, aux: p.aux, verb: p.verb };
      }
    }
  }
  // 3. since + a starting point, but no present perfect.
  if (on("since_without_perfect") && f.sinceWithoutPerfect) {
    return { ...blank(), verdict: "incorrect", category: "since_without_perfect", reasons: ["since_without_perfect"] };
  }
  // 4. have/has + a simple-past form ("have went").
  if (on("participle_form") && f.wrongParticiple.length) {
    const w = f.wrongParticiple[0];
    return { ...blank(), verdict: "incorrect", category: "participle_form", reasons: ["wrong_participle"], aux: w.aux, verb: w.verb };
  }
  return null;
}

const pastOutsidePerfectClauses = (f: Features) => f.past.some((p) => ![...f.perfect, ...f.ambiguousPerfect].some((h) => h.sentence === p.sentence && h.clause === p.clause));
const onlyBeOrContinuous = (f: Features) => f.past.every((p) => p.kind === "be");

function finishedFrame(f: Features): Evaluation {
  const anyPerfect = f.perfect.length > 0 || f.ambiguousPerfect.length > 0;
  if (f.past.length > 0) {
    if (!anyPerfect) return correct(["past_form"], onlyBeOrContinuous(f));
    if (pastOutsidePerfectClauses(f)) return correct(["past_form_in_separate_clause"], onlyBeOrContinuous(f));
    return uncertain(["mixed_perfect_and_past_same_clause"], { suspected: "pp_without_marker" });
  }
  if (anyPerfect) return uncertain(["perfect_without_finished_marker"], { suspected: "pp_without_marker" });
  if (f.ambiguousTenseWord && f.hasFinite === false) return uncertain(["ambiguous_tense_word"]);
  if (!f.hasFinite) return uncertain(["no_finite_verb"], { notAnAttempt: true });
  if (f.hasFinitePresent) return uncertain(["present_form_for_finished_question"], { suspected: "present_for_past" });
  return uncertain(["no_tense_evidence"]);
}

function unfinishedFrame(f: Features, text: string): Evaluation {
  if (f.perfect.length > 0) return correct(["present_perfect"], false);
  if (f.ambiguousPerfect.length > 0) return uncertain(["ambiguous_apostrophe_s"]);
  const c = withoutHedges(cleaned(text));
  if (UNFINISHED_FRAGMENTS.some((re) => re.test(c)) || isFragmentAnswer(f)) return correct(["natural_short_answer"], true);
  if (f.past.length > 0 && f.markers.length > 0) return correct(["past_with_finished_marker"], true);
  if (f.past.length > 0 && f.forDuration) return uncertain(["past_simple_with_for"], { suspected: "past_simple_for_ongoing" });
  if (f.hasFinitePresent && f.forDuration && !f.futureOrHabit) return uncertain(["present_with_for"], { suspected: "present_with_for" });
  if (!f.hasFinite) return uncertain(["no_finite_verb"], { notAnAttempt: true });
  return uncertain(["no_tense_evidence"]);
}

const OPENER = /^(?:yes|yeah|yep|yup|no|nope|never|not really|sure|of course|definitely|absolutely|certainly|not that i remember)\b/;
/** Hedges that carry no tense of their own: "I don't know exactly", "I'm not sure". */
const HEDGE_CLAUSE = /^(?:(?:but|though|although|well|hmm|so)\s+)*(?:i do not know|i do not remember|i can not remember|i am not (?:sure|certain)|not (?:sure|certain)|let me think)(?:\s+(?:exactly|really|precisely|offhand|now))?$/;

/** The whole answer is a natural short answer, possibly hedged: "I don't know exactly, maybe since 2020." */
function isFragmentAnswer(f: Features): boolean {
  const frag = (t: string) => UNFINISHED_FRAGMENTS.some((re) => re.test(withoutHedges(cleaned(t))));
  return f.sentences.some((s) => s.clauses.some((c) => frag(c.text)) && s.clauses.every((c) => frag(c.text) || HEDGE_CLAUSE.test(cleaned(c.text))));
}

const SHORT_ANSWER = /^(?:yes|yeah|yep|yup|no|nope|never|not really|sure|of course|definitely|absolutely|certainly)(?: i)?(?: have| have not| has| has not| did| did not| do| do not)?(?: never)?$/;

function experienceFrame(f: Features, text: string): Evaluation {
  const c = cleaned(text);
  const first = cleaned(f.sentences[0]?.clauses[0]?.text ?? "");
  if (f.perfect.length > 0) return correct(["present_perfect"], false);
  if (SHORT_ANSWER.test(c) || /^i (?:have|have not|never)$/.test(c) || SHORT_ANSWER.test(first) || /^i (?:have|have not)$/.test(first)) return correct(["short_answer"], true);
  if (f.past.length > 0) return correct(["past_simple_answer"], true);
  if (f.ambiguousPerfect.length > 0) return uncertain(["ambiguous_apostrophe_s"]);
  if (OPENER.test(c)) return correct(["yes_no_opener"], true);
  if (!f.hasFinite) return uncertain(["no_finite_verb"], { notAnAttempt: true });
  return uncertain(["no_tense_evidence"]);
}

export function evaluate(item: EvaluatorItem, input: EvaluationInput): Evaluation {
  const raw = input.text ?? "";
  if (!raw.trim()) return uncertain(["empty"], { notAnAttempt: true });
  if (raw.length > MAX_TEXT_LENGTH) return uncertain(["too_long"]);

  const n = normalizeInput(raw);
  if (n.repaired && n.tooShort) return uncertain(["self_repair_too_short"]);
  if (!n.text) return uncertain(["empty"], { notAnAttempt: true });

  const f = analyze(n.text);
  const tokens = f.sentences.flatMap((s) => s.tokens);
  if (tokens.length === 0) return uncertain(["no_words"], { notAnAttempt: true });
  if (!tokens.some((t) => COMMON_ENGLISH.has(t))) return uncertain(["not_english_or_gibberish"], { notAnAttempt: true });

  const err = targetError(item, f);
  if (err) return n.repaired ? { ...err, reasons: [...err.reasons, "after_self_repair"] } : err;

  const base =
    item.frame === "finished" ? finishedFrame(f)
    : item.frame === "unfinished" ? unfinishedFrame(f, n.text)
    : experienceFrame(f, n.text);
  return n.repaired ? { ...base, reasons: [...base.reasons, "after_self_repair"] } : base;
}

export type { Suspected };
