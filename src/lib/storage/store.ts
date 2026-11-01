import type { StoredState } from "@/types/session";
import { onScopeChange } from "@/lib/scope/storage-scope";
import type { PersistenceAdapter } from "./adapter";
import { localStorageAdapter } from "./local-storage-adapter";
import { emptyState, parseStoredState } from "./schema";

/**
 * Tiny external store shaped for useSyncExternalStore. Persistence goes through an adapter, so
 * storage can change later without touching the app. Never used during server rendering:
 * getServerSnapshot returns null.
 */

let adapter: PersistenceAdapter = localStorageAdapter;
let cachedKey: string | null | undefined;
let cachedState: StoredState = emptyState();
let memoryOnly = false; // storage unavailable or full: keep working in memory
const listeners = new Set<() => void>();

/** Swap the persistence backend (used by tests and, later, a remote adapter). */
export function setPersistenceAdapter(next: PersistenceAdapter): void {
  adapter = next;
  resetStoreCache();
}

export function getSnapshot(): StoredState {
  if (memoryOnly) return cachedState;
  const { primary, legacy } = adapter.read();
  const key = primary ?? (legacy !== null ? `legacy:${legacy}` : null);
  if (key === cachedKey) return cachedState;
  cachedKey = key;

  const source = primary ?? legacy;
  const parsed = parseStoredState(source);
  if (source && !parsed) adapter.quarantine(source);
  cachedState = parsed ?? emptyState();
  return cachedState;
}

export function getServerSnapshot(): StoredState | null {
  return null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribe = adapter.subscribe(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

export function updateState(update: (state: StoredState) => StoredState): StoredState {
  const next = update(getSnapshot());
  const serialized = JSON.stringify(next);
  if (adapter.write(serialized)) {
    cachedKey = serialized;
    memoryOnly = false;
  } else {
    memoryOnly = true;
  }
  cachedState = next;
  listeners.forEach((listener) => listener());
  return next;
}

/** Test helper: forget cached data so the next read hits storage again. */
export function resetStoreCache(): void {
  cachedKey = undefined;
  cachedState = emptyState();
  memoryOnly = false;
}

// Another learner's (or the guest's) saved progress is a different document: forget what was cached and tell every subscriber to re-read.
onScopeChange(() => {
  resetStoreCache();
  listeners.forEach((listener) => listener());
});
