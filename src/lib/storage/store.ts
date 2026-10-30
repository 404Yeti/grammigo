import type { StoredState } from "@/types/session";
import { emptyState, parseStoredState, STORAGE_KEY } from "./schema";

/**
 * Tiny external store over localStorage, shaped for useSyncExternalStore.
 * Never touched during server rendering: getServerSnapshot returns null.
 */

let cachedRaw: string | null | undefined;
let cachedState: StoredState = emptyState();
let memoryOnly = false; // localStorage unavailable or full: keep working in memory
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getSnapshot(): StoredState {
  if (memoryOnly) return cachedState;
  const raw = readRaw();
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  const parsed = parseStoredState(raw);
  if (raw && !parsed) {
    // Keep unreadable data aside instead of silently destroying it.
    try {
      window.localStorage.setItem(`${STORAGE_KEY}:corrupt`, raw);
    } catch {
      /* ignore */
    }
  }
  cachedState = parsed ?? emptyState();
  return cachedState;
}

export function getServerSnapshot(): StoredState | null {
  return null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function updateState(update: (state: StoredState) => StoredState): StoredState {
  const next = update(getSnapshot());
  const serialized = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  cachedState = next;
  listeners.forEach((listener) => listener());
  return next;
}

/** Test helper: forget cached data so the next read hits localStorage again. */
export function resetStoreCache(): void {
  cachedRaw = undefined;
  cachedState = emptyState();
  memoryOnly = false;
}
