import { guidedReleaseStatus } from "./release";

/**
 * Whether learners can reach Guided Correction at all. In a production build it stays hidden (entry
 * cards absent, route 404) until the release gate is clear, unless a preview build opts in with
 * NEXT_PUBLIC_GUIDED_PREVIEW=true. Development and tests always see it. Production v0.2 is unaffected.
 */
export function guidedVisible(): boolean {
  if (process.env.NEXT_PUBLIC_GUIDED_PREVIEW === "true") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return guidedReleaseStatus().releasable;
}
