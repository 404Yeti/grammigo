import type { GuidedState } from "@/types/guided";
import { GUIDED_STORAGE_KEY, emptyGuidedState, parseGuidedState } from "./schema";

/**
 * External store for Guided Correction history, shaped for useSyncExternalStore like the lesson
 * store, but on its own key and its own adapter. It never reads or writes the lesson document.
 */
export interface GuidedPersistence {
  read(): string | null;
  /** False when the write could not be persisted (the app keeps working in memory). */
  write(serialized: string): boolean;
  /** Keeps unreadable data aside instead of destroying it. */
  quarantine(raw: string): void;
  subscribe(onExternalChange: () => void): () => void;
}

const get = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const guidedLocalStorage: GuidedPersistence = {
  read: () => get(GUIDED_STORAGE_KEY),
  write(serialized) {
    try {
      window.localStorage.setItem(GUIDED_STORAGE_KEY, serialized);
      return true;
    } catch {
      return false;
    }
  },
  quarantine(raw) {
    try {
      window.localStorage.setItem(`${GUIDED_STORAGE_KEY}:corrupt`, raw);
    } catch {
      /* ignore */
    }
  },
  subscribe(onChange) {
    const handler = (event: StorageEvent) => {
      if (event.key === GUIDED_STORAGE_KEY || event.key === null) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

let persistence: GuidedPersistence = guidedLocalStorage;
let cachedRaw: string | null | undefined;
let cachedState: GuidedState = emptyGuidedState();
/** The last write failed (storage full or unavailable): keep working in memory, and try to save again on the next change. */
let memoryOnly = false;
/** Written by a newer version of the app: read nothing, overwrite nothing, until the data is cleared. */
let blocked = false;
const listeners = new Set<() => void>();

export function setGuidedPersistence(next: GuidedPersistence): void {
  persistence = next;
  resetGuidedStoreCache();
}

export function getGuidedSnapshot(): GuidedState {
  if (memoryOnly) return cachedState;
  const raw = persistence.read();
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  const parsed = parseGuidedState(raw);
  switch (parsed.kind) {
    case "ok":
      cachedState = parsed.state;
      break;
    case "empty":
      cachedState = emptyGuidedState();
      break;
    case "corrupt":
      if (raw) persistence.quarantine(raw);
      cachedState = emptyGuidedState();
      break;
    case "future":
      cachedState = emptyGuidedState();
      blocked = true;
      memoryOnly = true;
      break;
  }
  return cachedState;
}

export const getGuidedServerSnapshot = (): GuidedState | null => null;

export function subscribeGuided(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribe = persistence.subscribe(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

export function updateGuided(update: (state: GuidedState) => GuidedState): GuidedState {
  const next = update(getGuidedSnapshot());
  if (!blocked) {
    const serialized = JSON.stringify(next);
    if (persistence.write(serialized)) {
      cachedRaw = serialized;
      memoryOnly = false;
    } else memoryOnly = true;
  }
  cachedState = next;
  listeners.forEach((l) => l());
  return next;
}

/** Test helper: forget cached data so the next read hits storage again. */
export function resetGuidedStoreCache(): void {
  cachedRaw = undefined;
  cachedState = emptyGuidedState();
  memoryOnly = false;
  blocked = false;
}
