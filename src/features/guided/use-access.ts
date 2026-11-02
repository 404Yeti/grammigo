"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getStorageScope, onScopeChange } from "@/lib/scope/storage-scope";
import { guidedOwnerPreviewRequested, guidedVisible } from "./visibility";

/** An affordance only: the server page independently verifies access. Never retain owner access across scope changes. */
export function useGuidedAccess(): boolean {
  const scope = useSyncExternalStore(onScopeChange, getStorageScope, () => "");
  const [result, setResult] = useState<{ scope: string; allowed: boolean } | null>(null);
  const publicAccess = guidedVisible();
  useEffect(() => {
    if (publicAccess || !guidedOwnerPreviewRequested()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch("/api/guided/access", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setResult({ scope, allowed: body?.allowed === true }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ scope, allowed: false }); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scope, publicAccess]);
  return publicAccess || (result?.scope === scope && result.allowed);
}
