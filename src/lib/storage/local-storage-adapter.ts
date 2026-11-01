import type { PersistenceAdapter, RawSnapshot } from "./adapter";
import { getStorageScope, scopedKey } from "@/lib/scope/storage-scope";
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
    const primary = get(scopedKey(STORAGE_KEY));
    // The pre-v0.2 key belongs to the guest only: an account's progress never falls back to it.
    return { primary, legacy: primary === null && getStorageScope() === "" ? get(LEGACY_STORAGE_KEY) : null };
  },
  write(serialized) {
    try {
      window.localStorage.setItem(scopedKey(STORAGE_KEY), serialized);
      return true;
    } catch {
      return false;
    }
  },
  quarantine(raw) {
    try {
      window.localStorage.setItem(`${scopedKey(STORAGE_KEY)}:corrupt`, raw);
    } catch {
      /* ignore */
    }
  },
  subscribe(onChange) {
    const handler = (event: StorageEvent) => {
      if (event.key === scopedKey(STORAGE_KEY) || event.key === null) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};
