import type { SyncStatus } from "./engine";

export type StatusTone = "success" | "neutral" | "warning" | "info";
export type StatusView = { label: string; tone: StatusTone; detail: string };

/**
 * What to tell the learner about saving. The wording is deliberate: "Saved to your account" is shown ONLY when the account really holds
 * everything done on this device (a save has finished and nothing has changed since). In every other state the plain truth is that the
 * progress is safe on this device, and what is, or is not, happening to the copy online.
 */
export function describeStatus(s: SyncStatus | null, ago: (t: number) => string): StatusView {
  if (!s || s.phase === "off" || s.paused) return { label: "Progress on this device", tone: "neutral", detail: "Saving to your account is off. Your progress stays on this device." };
  switch (s.phase) {
    case "needs_consent":
      return { label: "Progress on this device", tone: "neutral", detail: "Your progress is not saved online. Turn saving on to keep it in your account." };
    case "syncing":
      return { label: "Saving…", tone: "info", detail: "Saving your progress to your account. You can keep learning." };
    case "offline":
      return { label: "Offline · saved on this device", tone: "warning", detail: "No connection. Everything is saved on this device and will go to your account when you are back online." };
    case "retrying":
      return { label: "Saved on this device", tone: "warning", detail: "We couldn’t reach your account just now. Nothing is lost; we’ll try again by ourselves." };
    case "needs_signin":
      return { label: "Saved on this device", tone: "warning", detail: "Your sign-in has ended, so saving to your account is paused. Sign in again to continue." };
    case "too_large":
      return { label: "Saved on this device", tone: "warning", detail: "Your progress has grown too large to save online. It is safe on this device." };
    case "blocked":
      return { label: "Saved on this device", tone: "warning", detail: "Your account has progress from a newer version of Grammigo, so saving is paused. Nothing was changed." };
    case "idle":
      if (s.unsaved) return { label: "Saved on this device", tone: "info", detail: "Your latest progress will go to your account shortly." };
      return s.lastSyncedAt !== null
        ? { label: "Saved to your account", tone: "success", detail: `Last saved ${ago(s.lastSyncedAt)}.` }
        : { label: "Saved on this device", tone: "info", detail: "Checking your account…" };
  }
}
