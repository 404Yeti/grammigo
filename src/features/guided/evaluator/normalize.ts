/**
 * Turns what the learner typed, or the transcript they confirmed, into a predictable shape:
 * contractions expanded, spoken fillers and self-repairs handled, clauses split.
 * Pure and deterministic. Never throws.
 */

const FILLERS = /\b(?:um+|uh+|er+|erm|hmm+|ah+|mm+)\b/gi;
const REPAIR = /\b(?:i mean|sorry|no wait|wait no|or rather|let me start again|let me say that again|scratch that)\b/gi;
const TYPO_CONTRACTIONS: [RegExp, string][] = [
  [/\bive\b/g, "i have"], [/\bweve\b/g, "we have"], [/\btheyve\b/g, "they have"], [/\byouve\b/g, "you have"],
  [/\bim\b/g, "i am"], [/\bdidnt\b/g, "did not"], [/\bhavent\b/g, "have not"], [/\bhasnt\b/g, "has not"],
  [/\bdont\b/g, "do not"], [/\bwasnt\b/g, "was not"],
];

export interface Normalized {
  /** Lower-cased text with contractions expanded; punctuation kept for clause splitting. */
  text: string;
  /** The learner restarted mid-sentence ("I have watched… I mean I watched"). Only the restart is judged. */
  repaired: boolean;
  /** After a restart almost nothing was left to judge. */
  tooShort: boolean;
}

const words = (s: string) => s.split(/[^a-z0-9']+/).filter(Boolean);

export function expandContractions(input: string): string {
  return input
    .replace(/\b(i|you|we|they)'ve\b/g, "$1 have")
    .replace(/\b(i|you|he|she|we|they|it)'ll\b/g, "$1 will")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\b(you|we|they)'re\b/g, "$1 are")
    .replace(/\b(he|she|it|that|there|what|who|where|how|here)'s\b/g, "$1 's")
    .replace(/\b(i|you|he|she|we|they|it)'d\b/g, "$1 'd")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bcan't\b/g, "can not")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/\b(\w+)n't\b/g, "$1 not")
    .replace(/\bgonna\b/g, "going to")
    .replace(/\bwanna\b/g, "want to");
}

export function normalizeInput(raw: string): Normalized {
  let t = raw
    .normalize("NFKC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”"]/g, " ")
    .replace(/[–—]/g, " , ")
    .replace(/\.{2,}|…/g, " , ")
    .toLowerCase();

  t = t.replace(FILLERS, " ");

  let repaired = false;
  let tooShort = false;
  const parts = t.split(REPAIR);
  if (parts.length > 1) {
    repaired = true;
    t = parts[parts.length - 1];
    if (words(t).length < 3) tooShort = true;
  }

  for (const [re, rep] of TYPO_CONTRACTIONS) t = t.replace(re, rep);
  t = expandContractions(t);
  // "i i went" / "the the film": stammered repeats of function words only ("had had" is legitimate).
  t = t.replace(/\b(i|we|they|he|she|it|the|a|an|and|to|my|then|so)(\s+\1\b)+/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  return { text: t, repaired, tooShort };
}

export const tokenize = (s: string): string[] => s.split(/[^a-z0-9']+/).filter(Boolean);

export interface Clause {
  tokens: string[];
  text: string;
}
export interface Sentence {
  tokens: string[];
  clauses: Clause[];
}

const MARKER_ONLY = new RegExp(
  "^(?:then |and |but |so |well )?(?:yesterday(?: (?:morning|afternoon|evening|night))?|last (?:night|evening|week|weekend|month|year|summer|winter|spring|autumn|fall|time|\\w+day)|\\d+ \\w+ ago|(?:a|an|one|two|three|four|five|six|ten) \\w+ ago|(?:in|since|for) (?:19|20)\\d\\d|in (?:19|20)\\d\\d|\\w+ ago)$",
);

/** Sentences, each split into comma clauses. A time phrase on its own ("yesterday evening,") joins its neighbour. */
export function toSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  for (const raw of text.split(/[.!?;:]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const segs = s.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
    const merged: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (MARKER_ONLY.test(segs[i])) {
        if (i + 1 < segs.length) segs[i + 1] = `${segs[i]} ${segs[i + 1]}`;
        else if (merged.length) merged[merged.length - 1] += ` ${segs[i]}`;
        else merged.push(segs[i]);
      } else merged.push(segs[i]);
    }
    out.push({ tokens: tokenize(s), clauses: merged.map((m) => ({ text: m, tokens: tokenize(m) })) });
  }
  return out;
}
