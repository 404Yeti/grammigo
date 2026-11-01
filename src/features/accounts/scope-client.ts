"use client";

import { useSyncExternalStore } from "react";
import { getStorageScope, isValidScope, onScopeChange, setStorageScope } from "@/lib/scope/storage-scope";
import { accountsEnabled } from "./enabled";

/**
 * Browser side of "whose saved progress is this?". The server sets a small cookie holding the signed-in learner's account id when someone
 * signs in and removes it when they sign out. Page script reads it synchronously at start-up, before any lesson screen reads its saved
 * progress, and switches the storage scope to it. No network is involved, and the cookie grants no access to anything: it only picks a
 * folder of local progress. (Who someone IS is proved only by the httpOnly session cookie, checked by the server.)
 */
const name = () => (window.location.protocol === "https:" ? "__Host-gm-scope" : "gm-scope");

export function readScopeCookie(): string {
  const prefix = `${name()}=`;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? "";
  return isValidScope(raw) ? raw : "";
}

export function writeScopeCookie(id: string): void {
  if (!isValidScope(id) || id === "") return;
  document.cookie = `${name()}=${id}; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}

/** Called once when the app loads in the browser. With accounts off it does nothing at all. */
export function initScopeFromCookie(): void {
  if (typeof document === "undefined" || !accountsEnabled()) return;
  setStorageScope(readScopeCookie());
}

/** The current scope as React state: "" for the guest, an account id when signed in. Never a mismatch on the server (always ""). */
export function useStorageScope(): string {
  return useSyncExternalStore(onScopeChange, getStorageScope, () => "");
}
