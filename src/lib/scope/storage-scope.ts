/**
 * Which learner's saved progress this browser is reading and writing: the STORAGE SCOPE.
 *
 *   ""            the guest: the original, un-prefixed keys. Exactly what Grammigo has always used.
 *   "<account id>" a signed-in learner: the same keys with ":u:<id>" appended, so every account on a shared device has its own,
 *                  separate saved progress, and none of them can see, overwrite or merge into the guest's or each other's.
 *
 * This module knows nothing about accounts, sign-in or the network: it is a pure, synchronous key-namespace switch that the lesson
 * store and the Guided Correction store both consult. With the scope left at "" (the default, and always the case while accounts are
 * off) every key is byte-for-byte the key Grammigo used before this module existed.
 */
const VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let scope = "";
const listeners = new Set<() => void>();

export const getStorageScope = (): string => scope;

/** True for "" (guest) and for a well-formed account id. Anything else is refused, so a key can never be built from arbitrary text. */
export const isValidScope = (s: string): boolean => s === "" || VALID.test(s);

export function setStorageScope(next: string): void {
  if (!isValidScope(next)) throw new Error("invalid storage scope");
  if (next === scope) return;
  scope = next;
  listeners.forEach((l) => l());
}

/** Stores register here to drop their caches and re-read when the scope changes. */
export function onScopeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `base` for the guest; `base:u:<id>` for an account. */
export const scopedKey = (base: string, forScope: string = scope): string => (forScope === "" ? base : `${base}:u:${forScope}`);
