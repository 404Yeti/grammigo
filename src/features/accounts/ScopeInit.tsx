"use client";

import { initScopeFromCookie } from "./scope-client";

// Runs when this module is first loaded in the browser, which is before any screen reads its saved progress.
initScopeFromCookie();

/** Renders nothing. It exists so the root layout can load the module above. */
export function ScopeInit() {
  return null;
}
