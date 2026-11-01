import { getStorageScope } from "@/lib/scope/storage-scope";
import { peekStoredState } from "@/lib/storage/peek";
import { peekGuidedState } from "./guided-doc";

/**
 * A copy of the progress held ON THIS DEVICE for the learner who is using it now, as a file they can keep. Read-only: it changes nothing here
 * and sends nothing anywhere. It is the way to keep progress when it is too big to save online. (The full account export, which comes from
 * the account itself, is separate: see /api/account/export.)
 */
export type LocalCopy = { format: "grammigo-device-copy"; version: 1; exportedAt: string; scope: "guest" | "account"; lessons: unknown; guided: unknown };

export function buildLocalCopy(now: Date = new Date()): LocalCopy {
  const scope = getStorageScope();
  return { format: "grammigo-device-copy", version: 1, exportedAt: now.toISOString(), scope: scope === "" ? "guest" : "account", lessons: peekStoredState(scope), guided: peekGuidedState(scope) };
}

export function localCopyFilename(now: Date = new Date()): string {
  return `grammigo-progress-on-this-device-${now.toISOString().slice(0, 10)}.json`;
}

/** Hands the browser a file to save. Returns false (and does nothing else) if the browser refuses. */
export function downloadLocalCopy(now: Date = new Date()): boolean {
  try {
    const blob = new Blob([JSON.stringify(buildLocalCopy(now), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = localCopyFilename(now);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
