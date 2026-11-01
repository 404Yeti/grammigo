import type { SupabaseClient } from "@supabase/supabase-js";
import { listTopics } from "@/curriculum";
import { errorCodes, parsePreferences, profileUpdateSchema, toRow, type ProfileView } from "@/features/accounts/profile";
import type { AuthConfig } from "./config";
import { clientAddress } from "./client-ip";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS, type RateLimitStore } from "./rate-limit";
import type { Viewer } from "./viewer";

/**
 * A learner's own profile: read and edit.
 *
 * Every read and write here goes through `client`, the learner's OWN session client (anon key + their cookie). There is no service-role
 * client in this module and none is accepted: row-level security and the column-level grants (only name, first language, time zone and
 * preferences are updatable; never status, age confirmation or id) decide what happens, as a second check beside the identity checks here.
 * The learner's id is taken from the VERIFIED session, never from the request, so there is no way to name another person's profile.
 */
export type ProfileDeps = {
  config: AuthConfig;
  viewer: Viewer;
  /** The learner's own client. */
  client: SupabaseClient;
  limiter: RateLimitStore;
  headers: Headers;
};

export type ProfileResult = { status: number; body: unknown; retryAfter?: number };

const MAX_BODY_BYTES = 4096;

function denied(viewer: Viewer): ProfileResult | null {
  if (viewer.kind === "anonymous") return { status: 401, body: { error: "unauthenticated" } };
  if (viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  return null;
}

export async function readProfile(client: SupabaseClient, userId: string): Promise<ProfileView | null> {
  const topics = listTopics();
  const { data, error } = await client.from("profiles").select("display_name, first_language, preferences, created_at").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const user = await client.auth.getUser();
  return {
    displayName: String(data.display_name),
    firstLanguage: data.first_language ?? null,
    preferences: parsePreferences(data.preferences, topics),
    memberSince: String(data.created_at),
    email: user.data.user?.email ?? null,
  };
}

export async function handleProfileGet(d: ProfileDeps): Promise<ProfileResult> {
  const refused = denied(d.viewer);
  if (refused) return refused;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  const profile = await readProfile(d.client, d.viewer.id);
  return profile ? { status: 200, body: profile } : { status: 403, body: { error: "forbidden" } };
}

export async function handleProfilePatch(d: ProfileDeps, raw: unknown): Promise<ProfileResult> {
  const refused = denied(d.viewer);
  if (refused) return refused;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isTrustedOrigin(d.headers, d.config.siteUrl)) return { status: 403, body: { error: "forbidden" } };
  if (Number(d.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { status: 413, body: { error: "too_large" } };

  try {
    const decision = await checkLimits(d.limiter, d.config.flowSecret, LIMITS.profile, `${d.viewer.id}:${clientAddress(d.headers)}`);
    if (!decision.allowed) return { status: 429, body: { error: "rate_limited" }, retryAfter: decision.retryAfter };
  } catch {
    return { status: 503, body: { error: "unavailable" } }; // fail closed
  }

  const parsed = profileUpdateSchema(listTopics()).safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid", fields: errorCodes(parsed.error) } };

  // The id comes from the verified session. `.eq("id", ...)` is belt and braces: row-level security already limits the update to this row.
  const { data, error } = await d.client.from("profiles").update(toRow(parsed.data)).eq("id", d.viewer.id).select("id").maybeSingle();
  if (error) return { status: 500, body: { error: "update_failed" } };
  if (!data) return { status: 403, body: { error: "forbidden" } }; // RLS matched no row: not an active learner after all
  const profile = await readProfile(d.client, d.viewer.id);
  return { status: 200, body: profile };
}
