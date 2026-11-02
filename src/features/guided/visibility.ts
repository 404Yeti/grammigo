import { guidedReleaseStatus } from "./release";

/** Public release access. A preview request alone never grants production access. */
export function guidedVisible(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return guidedReleaseStatus().releasable;
}

/** Server-only opt-in for disposable preview/testing builds; never authorizes public production. */
export function guidedPublicPreview(): boolean {
  return guidedVisible() || (process.env.VERCEL_ENV !== "production" && process.env.GUIDED_PUBLIC_PREVIEW === "true");
}

export function guidedOwnerPreviewRequested(): boolean {
  return process.env.NEXT_PUBLIC_GUIDED_PREVIEW === "true";
}

/**
 * Spoken answers are a separate release switch. They stay OFF in a production build (typed-only Guided Correction)
 * until real-device testing has been done; a build opts in with NEXT_PUBLIC_GUIDED_VOICE=true. Development and tests see it.
 */
export function guidedVoiceEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_GUIDED_VOICE === "true") return true;
  return process.env.NODE_ENV !== "production";
}
