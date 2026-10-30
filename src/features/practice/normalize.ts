export interface NormalizeOptions {
  /** Keep capitalization significant (for when capitalization is the skill being tested). */
  caseSensitive?: boolean;
  /** Keep punctuation significant (for when punctuation is the skill being tested). */
  keepPunctuation?: boolean;
}

// Unambiguous contractions only. "'s" and "'d" each have two meanings, so they are left alone.
const CONTRACTIONS: [RegExp, string][] = [
  [/\bi'm\b/gi, "I am"],
  [/\b(\w+)'ve\b/gi, "$1 have"],
  [/\b(\w+)'re\b/gi, "$1 are"],
  [/\b(\w+)'ll\b/gi, "$1 will"],
  [/\bcan't\b/gi, "cannot"],
  [/\bwon't\b/gi, "will not"],
  [/\b(\w+)n't\b/gi, "$1 not"],
];

/**
 * Normalizes a learner answer for comparison: unifies quotes, expands unambiguous
 * contractions, collapses whitespace, and (by default) ignores case and punctuation.
 */
export function normalizeAnswer(input: string, options: NormalizeOptions = {}): string {
  let text = input
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();

  for (const [pattern, replacement] of CONTRACTIONS) {
    text = text.replace(pattern, replacement);
  }

  if (!options.keepPunctuation) {
    text = text.replace(/["'.,!?;:()…]/g, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  return options.caseSensitive ? text : text.toLowerCase();
}

export function answersMatch(
  answer: string,
  accepted: readonly string[],
  options?: NormalizeOptions,
): boolean {
  const normalized = normalizeAnswer(answer, options);
  if (!normalized) return false;
  return accepted.some((candidate) => normalizeAnswer(candidate, options) === normalized);
}
