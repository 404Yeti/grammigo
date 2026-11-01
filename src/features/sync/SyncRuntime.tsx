"use client";

import { useEffect } from "react";
import { accountsEnabled } from "@/features/accounts/enabled";
import { useStorageScope } from "@/features/accounts/scope-client";
import { startSyncFor } from "./runtime";

/**
 * Starts background saving for the signed-in learner, and nothing else. It renders nothing, never blocks rendering, and does nothing at all
 * for a guest or while accounts are off. It is not part of the lesson path: lessons neither call it nor wait for it.
 */
export function SyncRuntime() {
  const scope = useStorageScope();
  useEffect(() => {
    if (!accountsEnabled() || scope === "") return;
    return startSyncFor(scope);
  }, [scope]);
  return null;
}
