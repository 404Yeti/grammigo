import {
  ADJECTIVAL_ED, AUXILIARIES, BASE_VERBS, MODAL_OR_TO, MONTHS, NUMBER_WORDS, PARTICIPLES, PAST_FORMS, PERFECT_ADVERBS,
  PRESENT_BE, STRONG_PARTICIPLES, UNITS, WEEKDAYS, WRONG_PARTICIPLE, isRegularEd, looksIng,
} from "./lexicon";
import { toSentences, type Sentence } from "./normalize";

export interface Hit {
  aux: string;
  verb: string;
  sentence: number;
  clause: number;
  /** Token position of the verb inside its clause. */
  index: number;
}
export interface PastHit {
  token: string;
  kind: "irregular" | "regular" | "be" | "did";
  sentence: number;
  clause: number;
  index: number;
}
export interface Marker {
  text: string;
  sentence: number;
  clause: number;
  /** Token position where the time expression starts inside its clause. */
  index: number;
}

export interface Features {
  sentences: Sentence[];
  /** Unambiguous have/has + participle. */
  perfect: Hit[];
  /** "'s" + regular -ed ("he's finished"): could be "has" or "is". Never used for a verdict. */
  ambiguousPerfect: Hit[];
  /** have/has + a simple-past form that is not the participle ("have went"). */
  wrongParticiple: Hit[];
  past: PastHit[];
  /** Finished-time expressions that really are finished (not "since last year" / "for the last year"). */
  markers: Marker[];
  sinceDuration: boolean;
  forPoint: boolean;
  sinceWithoutPerfect: { sentence: number } | null;
  forDuration: boolean;
  hasFinite: boolean;
  hasFinitePresent: boolean;
  futureOrHabit: boolean;
  ambiguousTenseWord: boolean;
}

const SUBJECTS = new Set(["i", "you", "he", "she", "we", "they", "it"]);
const PRESENT_ADVERBS = new Set(["always", "usually", "often", "also", "just", "really", "still", "never", "sometimes"]);

const isPastRegular = (w: string) => isRegularEd(w) && !ADJECTIVAL_ED.has(w);

/** True when the clause tokens contain a present-simple verb after a subject ("i live", "she works"). */
function presentSimple(tokens: string[]): boolean {
  for (let i = 1; i < tokens.length; i++) {
    let p = i - 1;
    while (p >= 0 && PRESENT_ADVERBS.has(tokens[p])) p--;
    if (p < 0 || !SUBJECTS.has(tokens[p])) continue;
    const t = tokens[i];
    if (BASE_VERBS.has(t) || (t.endsWith("s") && BASE_VERBS.has(t.slice(0, -1))) || (t.endsWith("es") && BASE_VERBS.has(t.slice(0, -2))) || (t.endsWith("ies") && BASE_VERBS.has(t.slice(0, -3) + "y"))) return true;
  }
  return false;
}

export function hasFiniteVerb(tokens: string[]): boolean {
  if (tokens.some((t) => AUXILIARIES.has(t) || PAST_FORMS.has(t) || isPastRegular(t))) return true;
  return presentSimple(tokens);
}

const FINISHED_PATTERNS: RegExp[] = [
  /\byesterday\b/g,
  new RegExp(`\\blast (?:night|evening|week|weekend|month|year|summer|winter|spring|autumn|fall|time|christmas|decade|semester|${WEEKDAYS}|${MONTHS})\\b`, "g"),
  new RegExp(`\\b(?:${NUMBER_WORDS}\\s+(?:${UNITS})\\s+)?ago\\b`, "g"),
  /\bin (?:19\d\d|20(?:0\d|1\d|2[0-5]))\b/g,
  /\bwhen i was\b/g,
  /\bas a (?:child|kid|teenager)\b/g,
  /\bthe other day\b/g,
  /\bthat (?:night|day|morning|evening|week|weekend)\b/g,
];
const EXCLUDING_PAIRS = new Set(["for the", "in the", "over the", "during the", "within the", "for these", "for those", "for this", "in these", "in those", "over these"]);

function findMarkers(clauseText: string): { text: string; index: number }[] {
  const found: { index: number; text: string; token: number }[] = [];
  for (const re of FINISHED_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(clauseText); m; m = re.exec(clauseText)) {
      if (!m[0]) { re.lastIndex++; continue; }
      const before = clauseText.slice(0, m.index).trim().split(/\s+/).filter(Boolean);
      const p1 = before[before.length - 1] ?? "";
      const p2 = before[before.length - 2] ?? "";
      if (p1 === "since" || EXCLUDING_PAIRS.has(`${p2} ${p1}`)) continue;
      found.push({ index: m.index, text: m[0].trim(), token: before.length });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => ({ text: f.text, index: f.token }));
}

function scanPerfect(tokens: string[], sentence: number, clause: number, out: Pick<Features, "perfect" | "ambiguousPerfect" | "wrongParticiple">, consumed: Set<number>) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t !== "have" && t !== "has" && t !== "'s") continue;
    if (t !== "'s" && i > 0 && MODAL_OR_TO.has(tokens[i - 1])) continue; // "would have", "to have"
    let j = i + 1;
    let skipped = 0;
    while (j < tokens.length && PERFECT_ADVERBS.has(tokens[j]) && skipped < 3) { j++; skipped++; }
    const v = tokens[j];
    if (!v) continue;
    const hit: Hit = { aux: t === "'s" ? "has" : t, verb: v, sentence, clause, index: j };
    if (t === "'s") {
      if (STRONG_PARTICIPLES.has(v)) { out.perfect.push(hit); consumed.add(j); }
      else if (WRONG_PARTICIPLE.has(v)) { out.wrongParticiple.push(hit); consumed.add(j); }
      else if (isPastRegular(v)) { out.ambiguousPerfect.push(hit); consumed.add(j); }
      continue;
    }
    if (PARTICIPLES.has(v)) { out.perfect.push(hit); consumed.add(j); }
    else if (WRONG_PARTICIPLE.has(v)) { out.wrongParticiple.push(hit); consumed.add(j); }
    else if (isRegularEd(v)) { out.perfect.push(hit); consumed.add(j); }
  }
}

const NOT_PAST_PREV = new Set([...MODAL_OR_TO, "have", "has", "had", "'s", "'d", "am", "is", "are", "be", "being", "been", "do", "does"]);

function scanPast(tokens: string[], sentence: number, clause: number, consumed: Set<number>, out: PastHit[], offset: number) {
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(offset + i)) continue;
    const t = tokens[i];
    const prev = tokens[i - 1] ?? "";
    if (t === "was" || t === "were") out.push({ token: t, kind: "be", sentence, clause, index: i });
    else if (t === "did") out.push({ token: t, kind: "did", sentence, clause, index: i });
    else if (PAST_FORMS.has(t)) {
      if (prev === "to" || prev === "will" || prev === "would" || prev === "can" || prev === "could" || prev === "should" || prev === "must") continue;
      out.push({ token: t, kind: "irregular", sentence, clause, index: i });
    } else if (isPastRegular(t) && !NOT_PAST_PREV.has(prev)) out.push({ token: t, kind: "regular", sentence, clause, index: i });
  }
}

/** "since 2019, I think": hedges are not the verb of the answer. */
const PARENTHETICAL = /\b(?:i think|i guess|i suppose|i believe|i reckon|you know|or something|or so|i would say)\b/g;
const withoutParentheticals = (tokens: string[]): string[] => tokens.join(" ").replace(PARENTHETICAL, " ").split(/\s+/).filter(Boolean);

/** Joins that start a new verb phrase: each side keeps its own time expression. */
const SPLIT_AT = new Set(["and", "but", "so", "because", "while", "which", "who", "that", "then", "although", "though", "since"]);

/** Splits a clause where two finite verbs meet, so a time word is judged with its own verb ("…the book you gave me yesterday"). */
export function splitSubclauses(tokens: string[]): string[][] {
  const parts: string[][] = [];
  let cur: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // "…gone to the cinema and watched a film yesterday": a verb right after and/but/then shares the subject and the
    // auxiliary of the first verb, so it is the same clause, not a new one.
    const next = tokens[i + 1 + (tokens[i + 1] === "then" ? 1 : 0)] ?? "";
    const sharesSubject = (t === "and" || t === "but" || t === "then") && (PAST_FORMS.has(next) || isPastRegular(next) || PARTICIPLES.has(next) || BASE_VERBS.has(next));
    if (SPLIT_AT.has(t) && !sharesSubject && cur.length > 0 && hasFiniteVerb(cur) && hasFiniteVerb(tokens.slice(i + 1))) {
      parts.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export function analyze(text: string): Features {
  const sentences = toSentences(text);
  const f: Features = {
    sentences, perfect: [], ambiguousPerfect: [], wrongParticiple: [], past: [], markers: [],
    sinceDuration: false, forPoint: false, sinceWithoutPerfect: null, forDuration: false,
    hasFinite: false, hasFinitePresent: false, futureOrHabit: false, ambiguousTenseWord: false,
  };

  sentences.forEach((s, si) => {
    let ci = 0;
    for (const c of s.clauses) {
      for (const part of splitSubclauses(c.tokens)) {
        const consumed = new Set<number>();
        scanPerfect(part, si, ci, f, consumed);
        scanPast(part, si, ci, consumed, f.past, 0);
        for (const m of findMarkers(part.join(" "))) f.markers.push({ text: m.text, sentence: si, clause: ci, index: m.index });
        ci++;
      }
    }

    const st = s.clauses.map((c) => c.text).join(" , ");
    const hasPerfectHere = [...f.perfect, ...f.ambiguousPerfect].some((h) => h.sentence === si);
    if (new RegExp(`\\bsince (?:${NUMBER_WORDS}) (?:${UNITS})\\b(?! ago)`).test(st)) f.sinceDuration = true;
    if (/\bfor (?:19|20)\d\d\b/.test(st) || new RegExp(`\\bfor last (?:week|month|year|summer|winter|${WEEKDAYS}|${MONTHS})\\b`).test(st)) f.forPoint = true;
    // "since 2020" is only an error next to a finite verb IN THE SAME CLAUSE ("I learn English since 2020"), never in a
    // hedged fragment that follows one ("I don't know exactly, maybe since 2020").
    const sincePointRe = new RegExp(`\\bsince (?:(?:19|20)\\d\\d|last \\w+|yesterday|${WEEKDAYS}|${MONTHS})\\b`);
    if (!hasPerfectHere && s.clauses.some((c) => sincePointRe.test(c.text) && hasFiniteVerb(withoutParentheticals(c.tokens)))) f.sinceWithoutPerfect = { sentence: si };
    // Evaluator 1.1.0 (P1): "for" followed by a clause ("for I was a child") is a starting point, not a duration.
    if (/\bfor (?:i|we|he|she|they) (?:was|were|am|started|began|came|moved|arrived|got|had|lived|first)\b/.test(st)) f.forPoint = true;
    // Evaluator 1.1.0 (P2): "since I was twelve" after a finite main verb with no perfect anywhere in the sentence.
    const sinceClauseRe = /\bsince (?:i|we|he|she|they) (?:was|were|started|began|came|moved|arrived|left|joined|graduated|got|had|first|lived)\b/;
    if (!hasPerfectHere && !f.sinceWithoutPerfect && s.clauses.some((c) => { const i = c.tokens.indexOf("since"); return i > 0 && sinceClauseRe.test(c.text) && hasFiniteVerb(withoutParentheticals(c.tokens.slice(0, i))); })) f.sinceWithoutPerfect = { sentence: si };
    if (new RegExp(`\\bfor (?:${NUMBER_WORDS}) (?:${UNITS})\\b`).test(st)) f.forDuration = true;
  });

  const all = sentences.flatMap((s) => s.tokens);
  f.hasFinite = hasFiniteVerb(all);
  f.hasFinitePresent = sentences.some((s) => presentSimple(s.tokens)) || all.some((t, i) => PRESENT_BE.has(t) && looksIng(all[i + 1] ?? ""));
  f.futureOrHabit = /\b(?:will|going to|next|another|more|until|every|each|tomorrow|plan)\b/.test(all.join(" "));
  f.ambiguousTenseWord = all.some((t) => ["read", "put", "set", "let", "cut", "hit", "hurt", "shut", "cost", "spread", "quit"].includes(t));
  return f;
}
