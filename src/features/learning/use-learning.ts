"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { StoredState } from "@/types/session";
import { deriveLearning, type Learning } from "./derive";

const FIVE_MINUTES = 5 * 60 * 1000;
const noSubscribe = () => () => {};
/** Bucketed so repeated reads within a render agree. Null on the server: no clock during prerender. */
const clientNow = () => Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES;
const serverNow = (): number | null => null;

/**
 * Derived learning data for the current saved state. Time-based estimates (recency, review due)
 * use a coarse clock, and nothing is computed until the browser has hydrated.
 */
export function useDerivedLearning(state: StoredState | null): Learning | null {
  const now = useSyncExternalStore<number | null>(noSubscribe, clientNow, serverNow);
  return useMemo(() => (state && now !== null ? deriveLearning(state, now) : null), [state, now]);
}
