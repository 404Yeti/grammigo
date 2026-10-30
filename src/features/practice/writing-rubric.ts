/**
 * Limited, transparent check for the short-writing question.
 *
 * It does NOT grade writing in general. It looks for two specific, checkable patterns:
 *   1. a sentence with have/has + a past participle (present perfect), and
 *   2. a different sentence with a finished-time word (yesterday, ago, last …) and a past form.
 * It also catches one clear error: a present perfect sentence paired with a finished time word.
 * Anything it cannot confirm is "unverified" and goes to review instead of being marked wrong.
 */

export type WritingVerdict =
  | { status: "pass" }
  | { status: "invalid"; message: string }
  | { status: "fail"; message: string }
  | { status: "unverified"; message: string };

const IRREGULAR_PARTICIPLES = new Set([
  "been", "seen", "done", "gone", "eaten", "written", "made", "taken", "had", "got", "gotten",
  "given", "read", "met", "bought", "begun", "known", "found", "heard", "left", "lost", "paid",
  "put", "run", "said", "sold", "sent", "set", "sat", "slept", "spoken", "spent", "stood", "swum",
  "thought", "told", "understood", "won", "worn", "brought", "built", "caught", "chosen", "come",
  "drawn", "driven", "drunk", "fallen", "felt", "flown", "forgotten", "grown", "held", "kept",
  "lent", "ridden", "risen", "shown", "sung", "taught", "thrown", "woken", "cut", "hit", "let",
]);

const IRREGULAR_PAST = new Set([
  "was", "were", "saw", "did", "went", "ate", "wrote", "made", "took", "had", "got", "gave", "read",
  "met", "bought", "began", "knew", "found", "heard", "left", "lost", "paid", "put", "ran", "said",
  "sold", "sent", "sat", "slept", "spoke", "spent", "stood", "swam", "thought", "told", "understood",
  "won", "wore", "brought", "built", "caught", "chose", "came", "drew", "drove", "drank", "fell",
  "felt", "flew", "forgot", "grew", "held", "kept", "lent", "rode", "rose", "showed", "sang",
  "taught", "threw", "woke", "cut", "hit", "let",
]);

const FINISHED_TIME =
  /\b(yesterday|ago|last\s+(night|week|weekend|month|year|summer|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(19|20)\d{2}|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

const PERFECT_AUX = /\b(have|has|i've|you've|we've|they've|haven't|hasn't)\b/i;

function words(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isParticiple(word: string): boolean {
  return word.endsWith("ed") || IRREGULAR_PARTICIPLES.has(word);
}

function hasPresentPerfect(sentence: string): boolean {
  const tokens = words(sentence);
  const FILLERS = new Set(["not", "never", "already", "just", "also", "ever", "really", "still"]);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isAux = /^(have|has)$/.test(token) || /'ve$/.test(token) || /^(haven't|hasn't)$/.test(token);
    if (!isAux) continue;
    let j = i + 1;
    while (j < tokens.length && FILLERS.has(tokens[j])) j++;
    if (j < tokens.length && isParticiple(tokens[j])) return true;
  }
  return false;
}

function hasPastSimpleWithFinishedTime(sentence: string): boolean {
  if (!FINISHED_TIME.test(sentence)) return false;
  if (hasPresentPerfect(sentence)) return false;
  return words(sentence).some((w) => w.endsWith("ed") || IRREGULAR_PAST.has(w));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 3);
}

export function evaluateWriting(text: string): WritingVerdict {
  const sentences = splitSentences(text);
  if (sentences.length < 2) {
    return {
      status: "invalid",
      message: "Write two sentences, each with at least three words.",
    };
  }

  const clash = sentences.find((s) => PERFECT_AUX.test(s) && hasPresentPerfect(s) && FINISHED_TIME.test(s));
  if (clash) {
    return {
      status: "fail",
      message:
        "One sentence pairs have/has + a participle with a finished time word (like yesterday). Finished times take the past simple.",
    };
  }

  const perfectIndex = sentences.findIndex(hasPresentPerfect);
  const pastIndex = sentences.findIndex((s, i) => i !== perfectIndex && hasPastSimpleWithFinishedTime(s));
  if (perfectIndex !== -1 && pastIndex !== -1) return { status: "pass" };

  return {
    status: "unverified",
    message:
      "Grammigo can’t check free writing automatically yet, so this answer is saved for review instead of being marked wrong.",
  };
}

/**
 * Generic structural pre-check for open writing that has no deterministic rubric.
 * It only decides whether there is enough text to give feedback on; it never judges grammar.
 */
export function precheckWriting(text: string): { ok: true } | { ok: false; message: string } {
  if (splitSentences(text).length < 2) {
    return { ok: false, message: "Write two sentences, each with at least three words." };
  }
  return { ok: true };
}
