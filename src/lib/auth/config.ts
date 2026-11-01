import { z } from "zod";
import { REAUTH_WINDOW_SECONDS } from "./constants";
import { boundedTimeoutMs } from "./timeout-fetch";

/**
 * Account configuration. Accounts are OFF unless NEXT_PUBLIC_ACCOUNTS is exactly "on"; with the flag off (the default) Grammigo is
 * exactly the anonymous, on-device app and every account route answers 404. With the flag ON but any secret missing or weak, every
 * account route answers 503: the app never falls back to a default secret.
 */
export type AuthConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  siteUrl: URL;
  /** Keys the invitation-code HMAC. Never leaves the server; changing it invalidates every existing code. */
  pepper: Buffer;
  /** Keys the signed flow cookie and the rate-limit buckets. Different from the pepper on purpose. */
  flowSecret: Buffer;
  cronSecret: string | null;
  /** True when the site is served over https: cookies get Secure and the __Host- prefix. */
  secureCookies: boolean;
  cookieNames: { auth: string; flow: string; scope: string };
  /** How recent a sign-in must be to delete an account. 1 to 600 seconds: the environment can only make this STRICTER than the default. */
  reauthWindowSeconds: number;
  /** How long any one request to Supabase may take before it is abandoned (1 to 15 seconds, default 8). */
  requestTimeoutMs: number;
};

export type AuthConfigState =
  | { state: "disabled" }
  | { state: "misconfigured"; problems: string[] }
  | { state: "ready"; config: AuthConfig };

const MIN_SECRET_CHARS = 32;

const httpUrl = z.url({ protocol: /^https?$/ });

export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfigState {
  if (env.NEXT_PUBLIC_ACCOUNTS !== "on") return { state: "disabled" };
  const problems: string[] = [];

  const supabaseUrl = env.SUPABASE_URL ?? "";
  const anonKey = env.SUPABASE_ANON_KEY ?? "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const pepperRaw = env.INVITE_CODE_PEPPER ?? "";
  const flowRaw = env.AUTH_FLOW_SECRET ?? "";
  const siteRaw = env.AUTH_SITE_URL ?? "";
  const cronSecret = env.CRON_SECRET ?? null;

  if (!httpUrl.safeParse(supabaseUrl).success) problems.push("SUPABASE_URL");
  if (!anonKey) problems.push("SUPABASE_ANON_KEY");
  if (!serviceKey) problems.push("SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey && anonKey === serviceKey) problems.push("SUPABASE_ANON_KEY must differ from SUPABASE_SERVICE_ROLE_KEY");
  if (pepperRaw.length < MIN_SECRET_CHARS) problems.push("INVITE_CODE_PEPPER (at least 32 characters)");
  if (flowRaw.length < MIN_SECRET_CHARS) problems.push("AUTH_FLOW_SECRET (at least 32 characters)");
  if (pepperRaw && pepperRaw === flowRaw) problems.push("INVITE_CODE_PEPPER and AUTH_FLOW_SECRET must differ");
  if (cronSecret !== null && cronSecret.length < MIN_SECRET_CHARS) problems.push("CRON_SECRET (at least 32 characters when set)");

  let siteUrl: URL | null = null;
  if (httpUrl.safeParse(siteRaw).success) {
    siteUrl = new URL(siteRaw);
    // A real deployment must be https. Plain http is allowed only for localhost (local development and the browser tests).
    const local = siteUrl.hostname === "localhost" || siteUrl.hostname === "127.0.0.1";
    if (siteUrl.protocol !== "https:" && !local) problems.push("AUTH_SITE_URL must be https");
    if (siteUrl.protocol !== "https:" && env.NODE_ENV === "production" && !local) problems.push("AUTH_SITE_URL must be https in production");
  } else problems.push("AUTH_SITE_URL");

  if (problems.length > 0 || !siteUrl) return { state: "misconfigured", problems };

  const asked = Number(env.AUTH_REAUTH_WINDOW_SECONDS);
  const reauthWindowSeconds = Number.isInteger(asked) && asked >= 1 && asked <= REAUTH_WINDOW_SECONDS ? asked : REAUTH_WINDOW_SECONDS;
  const secureCookies = siteUrl.protocol === "https:";
  const prefix = secureCookies ? "__Host-" : "";
  return {
    state: "ready",
    config: {
      supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
      anonKey,
      serviceKey,
      siteUrl: new URL(siteUrl.origin),
      pepper: Buffer.from(pepperRaw, "utf8"),
      flowSecret: Buffer.from(flowRaw, "utf8"),
      cronSecret,
      secureCookies,
      cookieNames: { auth: `${prefix}gm-auth`, flow: `${prefix}gm-flow`, scope: `${prefix}gm-scope` },
      reauthWindowSeconds,
      requestTimeoutMs: boundedTimeoutMs(env.AUTH_REQUEST_TIMEOUT_MS),
    },
  };
}
