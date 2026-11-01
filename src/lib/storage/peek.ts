import { scopedKey } from "@/lib/scope/storage-scope";
import type { StoredState } from "@/types/session";
import { LEGACY_STORAGE_KEY, parseStoredState, STORAGE_KEY } from "./schema";

/**
 * A READ-ONLY look at some learner's saved lesson progress, whoever the browser is currently pointed at. It parses a copy and returns it;
 * it writes nothing, caches nothing, quarantines nothing and notifies nobody. (Used to tell a signed-in learner that guest progress exists
 * on this device, and to count it: never to show it, and never to move it anywhere without their say-so.)
 */
export function peekStoredState(forScope: string): StoredState | null {
  try {
    const primary = window.localStorage.getItem(scopedKey(STORAGE_KEY, forScope));
    const raw = primary ?? (forScope === "" ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null);
    return parseStoredState(raw);
  } catch {
    return null;
  }
}
