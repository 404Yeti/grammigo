/**
 * Canonical JSON (keys sorted) and a fast non-cryptographic hash of it. Used ONLY to notice that a document has changed since it was last
 * saved, and to break ties between two otherwise equal values the same way on every device. It is not a security measure.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}

/** cyrb53: a well-distributed 53-bit hash, as a short string. */
export function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const hashDocument = (doc: unknown): string => hashOf(canonical(doc));

/** The same winner whichever order the two are given in. */
export function tieBreak<T>(a: T, b: T): T {
  return canonical(a) >= canonical(b) ? a : b;
}
