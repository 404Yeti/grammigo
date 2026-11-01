import { FLOW_TTL_SECONDS, newNonce, signFlow, type FlowPayload } from "./flow";
import type { AuthRuntime } from "./runtime";

export type StartInput = { intent: "signin" } | { intent: "join"; grantId: string; adultAt: string } | { intent: "reauth"; uid: string };
export type StartResult = { ok: true; url: string } | { ok: false };

/**
 * Begins Google sign-in: sets the signed flow cookie and returns the Google authorize URL.
 *
 * Before the browser is sent anywhere, the URL is checked: it must be OUR Supabase project, ask for Google, carry a PKCE S256
 * challenge, and return to OUR callback with the flow nonce. If any of that is wrong nothing is sent and any reserved seat is
 * handed back, so a mis-configured project fails closed instead of starting a sign-in nobody can verify.
 */
export async function startGoogle(rt: AuthRuntime, input: StartInput): Promise<StartResult> {
  const nonce = newNonce();
  const payload: FlowPayload = {
    v: 1,
    intent: input.intent,
    nonce,
    exp: Math.floor(rt.now() / 1000) + FLOW_TTL_SECONDS,
    ...(input.intent === "join" ? { grant: input.grantId, adultAt: input.adultAt } : {}),
    ...(input.intent === "reauth" ? { uid: input.uid } : {}),
  };
  const redirectTo = `${rt.config.siteUrl.origin}/api/auth/callback?flow=${nonce}`;

  const abandon = async () => {
    rt.jar.clearFlow(); // never clear the session cookie here: a signed-in learner pressing "sign in" must stay signed in
    if (input.intent === "join") await rt.db.release(input.grantId).catch(() => undefined); // the hold also expires by itself
    return { ok: false } as const;
  };

  let url: string | null;
  try {
    url = await rt.auth.startOAuth(redirectTo);
  } catch {
    return abandon();
  }
  if (!url || !isExpectedAuthorizeUrl(url, rt.config.supabaseUrl, redirectTo)) return abandon();

  rt.jar.setFlow(signFlow(payload, rt.config.flowSecret));
  return { ok: true, url };
}

export function isExpectedAuthorizeUrl(raw: string, supabaseUrl: string, redirectTo: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const base = new URL(supabaseUrl);
  return (
    u.origin === base.origin &&
    u.pathname.endsWith("/auth/v1/authorize") &&
    u.searchParams.get("provider") === "google" &&
    (u.searchParams.get("code_challenge") ?? "").length >= 43 &&
    u.searchParams.get("code_challenge_method")?.toLowerCase() === "s256" &&
    u.searchParams.get("redirect_to") === redirectTo
  );
}
