/**
 * Moving a guest's progress from the old address to the new one. A browser keeps saved progress separately for each web ADDRESS (origin),
 * so a guest sent from grammigo.vercel.app to grammigo.si would seem to lose everything. This feature lets the learner carry it across, by
 * their own action. It is OFF unless NEXT_PUBLIC_GUEST_TRANSFER is exactly "on": while off, both pages answer 404 and nothing changes.
 *
 * Both origins are fixed at build time (and checked): the sender only ever posts to TARGET, and the receiver only ever accepts from SOURCE.
 */
export const transferEnabled = (): boolean => process.env.NEXT_PUBLIC_GUEST_TRANSFER === "on";

export const DEFAULT_SOURCE_ORIGIN = "https://grammigo.vercel.app";
export const DEFAULT_TARGET_ORIGIN = "https://grammigo.si";

/** An origin we are willing to talk to: https, or plain http on localhost (tests). No path, no credentials. Anything else falls back to the default. */
export function safeOrigin(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.username || u.password) return fallback;
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return fallback;
    return u.origin;
  } catch {
    return fallback;
  }
}

export const transferOrigins = (): { source: string; target: string } => ({
  source: safeOrigin(process.env.NEXT_PUBLIC_TRANSFER_SOURCE_ORIGIN, DEFAULT_SOURCE_ORIGIN),
  target: safeOrigin(process.env.NEXT_PUBLIC_TRANSFER_TARGET_ORIGIN, DEFAULT_TARGET_ORIGIN),
});
