import type { PersistenceAdapter, RawSnapshot } from "./adapter";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "./schema";

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const localStorageAdapter: PersistenceAdapter = {
  read(): RawSnapshot {
    const primary = get(STORAGE_KEY);
    return { primary, legacy: primary === null ? get(LEGACY_STORAGE_KEY) : null };
  },
  write(serialized) {
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
      return true;
    } catch {
      return false;
    }
  },
  quarantine(raw) {
    try {
      window.localStorage.setItem(`${STORAGE_KEY}:corrupt`, raw);
    } catch {
      /* ignore */
    }
  },
  subscribe(onChange) {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};
