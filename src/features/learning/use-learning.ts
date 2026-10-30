"use client";

import { useMemo, useState } from "react";
import type { StoredState } from "@/types/session";
import { deriveLearning, type Learning } from "./derive";

/**
 * Derived learning data for the current saved state. "Now" is captured once when the screen
 * mounts, so recency and review-due calculations don't shift between renders.
 */
export function useDerivedLearning(state: StoredState | null): Learning | null {
  const [now] = useState(() => Date.now());
  return useMemo(() => (state ? deriveLearning(state, now) : null), [state, now]);
}
