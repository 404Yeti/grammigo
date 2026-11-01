import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is asking, as far as PRIVATE data is concerned. Only a `learner` may see anything private.
 *
 *  - anonymous:  no valid session. (Anonymous use of the lessons never goes through here: it needs no account.)
 *  - no_profile: a verified session whose user has no ACTIVE learner profile: an uninvited Google identity, a suspended account,
 *                or a half-finished sign-in. It gets nothing, and cannot tell which of those it is.
 *  - learner:    a verified session and an active profile.
 *
 * The session is verified with the Auth server (`getUser`), not just decoded, so a revoked or forged token fails here. The profile is
 * read AS the user, so row-level security is a second, independent check: a profile that RLS hides is a profile that does not exist.
 */
export type Viewer =
  | { kind: "anonymous" }
  | { kind: "no_profile" }
  | { kind: "learner"; id: string; displayName: string; isAdmin: boolean }
  /** The Auth server or the database could not be reached. It says NOTHING about who is asking, so it is never "signed out" and never "allowed". */
  | { kind: "unavailable" };

/** A failure of the network or the service itself, as opposed to a verdict about the session. */
function isOutage(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || error.status === 0 || (typeof error.status === "number" && error.status >= 500);
}

export async function getViewer(client: SupabaseClient): Promise<Viewer> {
  const { data, error } = await client.auth.getUser();
  if (isOutage(error)) return { kind: "unavailable" };
  if (error || !data.user) return { kind: "anonymous" };
  const profile = await client.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle();
  if (profile.error) return { kind: "unavailable" }; // the question could not be answered; that is not the same as "no profile"
  if (!profile.data) return { kind: "no_profile" };
  const admin = await client.rpc("is_admin");
  return { kind: "learner", id: data.user.id, displayName: String(profile.data.display_name), isAdmin: admin.data === true };
}

/** The HTTP status a private JSON endpoint answers a viewer with: 401 for no session, 403 for a session without access, 503 when we cannot tell. */
export function statusFor(viewer: Viewer): 200 | 401 | 403 | 503 {
  return viewer.kind === "learner" ? 200 : viewer.kind === "anonymous" ? 401 : viewer.kind === "unavailable" ? 503 : 403;
}
