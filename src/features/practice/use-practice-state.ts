"use client";

import { useSyncExternalStore } from "react";
import type { StoredState } from "@/types/session";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/storage/store";

/** Returns the persisted state, or null until the browser has hydrated (never reads storage on the server). */
export function usePracticeState(): StoredState | null {
  return useSyncExternalStore<StoredState | null>(subscribe, getSnapshot, getServerSnapshot);
}
