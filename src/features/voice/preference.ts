"use client";

import { useSyncExternalStore } from "react";
const KEY = "grammigo:audio:v1";
const listeners = new Set<() => void>();
let memoryMuted = false;
function read(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memoryMuted;
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "version" in value && value.version === 1 && "muted" in value && typeof value.muted === "boolean") return value.muted;
  } catch { /* blocked/corrupt storage: keep the in-memory preference */ }
  return memoryMuted;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
export function setMigoMuted(muted: boolean) {
  memoryMuted = muted;
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, muted })); } catch { /* memory remains usable */ }
  listeners.forEach(listener => listener());
}
export function useMigoMuted() { return useSyncExternalStore(subscribe, read, () => false); }
