/**
 * What we require of the identity Supabase hands back after Google sign-in. This runs on a user object fetched from the Auth server
 * (`getUser`), never on a client-supplied token.
 *
 * It is also the guard for "no automatic linking": a Google identity must stand ALONE. If Supabase ever attached it to an existing
 * account that has another sign-in method (same email address), the user would list more than one provider and is refused. In
 * production the email provider is off, so this cannot happen; this check keeps it that way if a setting is changed by mistake.
 */
export type AuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] } & Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: { provider: string; identity_data?: Record<string, unknown> | null }[] | null;
};

export type IdentityVerdict = { ok: true } | { ok: false; reason: "provider" | "unverified" | "linked" };

export function checkGoogleIdentity(user: AuthUser): IdentityVerdict {
  const providers = user.app_metadata?.providers ?? [];
  if (user.app_metadata?.provider !== "google") return { ok: false, reason: "provider" };
  if (providers.length !== 1 || providers[0] !== "google") return { ok: false, reason: "linked" };
  const identities = user.identities ?? [];
  if (identities.length !== 1 || identities[0].provider !== "google") return { ok: false, reason: "linked" };
  if (!user.email || !user.email_confirmed_at) return { ok: false, reason: "unverified" };
  // Google states whether it verified the address; GoTrue copies that into identity_data.
  if (identities[0].identity_data?.email_verified !== true) return { ok: false, reason: "unverified" };
  return { ok: true };
}

/** A display name from what Google provides, bounded and stripped of control characters. The learner can change it later. */
export function displayNameFrom(user: AuthUser): string {
  const meta = user.user_metadata ?? {};
  const candidate = [meta.full_name, meta.name, meta.given_name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  const cleaned = (candidate ?? user.email?.split("@")[0] ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return cleaned || "Learner";
}
