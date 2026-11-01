import { loadAuthConfig, type AuthConfig } from "./config";
import { CookieSession } from "./cookie-session";
import type { AccountDb, ProfileState, RedeemResult, ReserveResult } from "./db";
import { newNonce, signFlow, type FlowPayload } from "./flow";
import type { AuthUser } from "./identity";
import { flowJar, type AuthRuntime, type SessionAuth } from "./runtime";

/** Shared fixtures for the unit tests. Nothing here is imported by application code. */
export const ENV = {
  NEXT_PUBLIC_ACCOUNTS: "on",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon-key-for-tests",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests",
  INVITE_CODE_PEPPER: "p".repeat(40),
  AUTH_FLOW_SECRET: "f".repeat(40),
  AUTH_SITE_URL: "http://localhost:3100",
  CRON_SECRET: "c".repeat(40),
} as const;

export function testConfig(over: Record<string, string | undefined> = {}): AuthConfig {
  const s = loadAuthConfig({ ...ENV, ...over });
  if (s.state !== "ready") throw new Error("test config not ready: " + JSON.stringify(s));
  return s.config;
}

export const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
export const GRANT = "11111111-1111-4111-8111-111111111111";
export const USER_ID = "22222222-2222-4222-8222-222222222222";

export function googleUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "learner@example.test",
    email_confirmed_at: "2026-11-01T11:59:00Z",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Ana Pérez" },
    identities: [{ provider: "google", identity_data: { email_verified: true } }],
    ...over,
  };
}

export function flowToken(config: AuthConfig, over: Partial<FlowPayload> = {}): { token: string; nonce: string } {
  const nonce = over.nonce ?? newNonce();
  const payload: FlowPayload = { v: 1, intent: "join", nonce, grant: GRANT, adultAt: "2026-11-01T11:58:00.000Z", exp: Math.floor(NOW / 1000) + 1800, ...over };
  if (payload.intent === "signin" || payload.intent === "reauth") {
    delete payload.grant;
    delete payload.adultAt;
  }
  return { token: signFlow(payload, config.flowSecret), nonce };
}

export type Fakes = {
  user: AuthUser | null;
  exchangeOk: boolean;
  profile: ProfileState;
  redeem: RedeemResult | "throw";
  reserve: ReserveResult | "throw";
  purge: boolean | "throw";
  release: "ok" | "throw";
  signOut: "ok" | "throw";
  startUrl: string | null | "throw";
  limiter: { allowed: boolean; retryAfter: number } | "throw";
  exchangeThrows: boolean;
};

export function makeRuntime(over: Partial<Fakes> = {}, cookies: { name: string; value: string }[] = []) {
  const f: Fakes = {
    user: googleUser(), exchangeOk: true, profile: "none", redeem: "ok", reserve: { grantId: GRANT }, purge: true, release: "ok",
    signOut: "ok", startUrl: null, limiter: { allowed: true, retryAfter: 1 }, exchangeThrows: false, ...over,
  };
  const config = testConfig();
  const calls: string[] = [];
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];
  const jarCookies = new CookieSession(cookies);

  const db: AccountDb = {
    async reserve() { calls.push("reserve"); if (f.reserve === "throw") throw new Error("db"); return f.reserve; },
    async redeem(a) { calls.push(`redeem:${a.displayName}`); if (f.redeem === "throw") throw new Error("db"); return f.redeem; },
    async release() { calls.push("release"); if (f.release === "throw") throw new Error("db"); },
    async profileState() { calls.push("profileState"); return f.profile; },
    async purgeOrphan() { calls.push("purge"); if (f.purge === "throw") throw new Error("db"); return f.purge; },
    limiter: { async hit() { calls.push("limit"); if (f.limiter === "throw") throw new Error("db"); return f.limiter; } },
  };
  const auth: SessionAuth = {
    async exchangeCodeForSession() { calls.push("exchange"); if (f.exchangeThrows) throw new Error("net"); return { ok: f.exchangeOk }; },
    async getUser() { calls.push("getUser"); return f.user; },
    async signOut() { calls.push("signOut"); if (f.signOut === "throw") throw new Error("net"); },
    async startOAuth(redirectTo) {
      calls.push("startOAuth");
      if (f.startUrl === "throw") throw new Error("net");
      if (f.startUrl !== null) return f.startUrl;
      const u = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
      u.searchParams.set("provider", "google");
      u.searchParams.set("redirect_to", redirectTo);
      u.searchParams.set("code_challenge", "x".repeat(43));
      u.searchParams.set("code_challenge_method", "s256");
      return u.toString();
    },
  };
  const rt: AuthRuntime = { config, db, auth, jar: flowJar(config, jarCookies), now: () => NOW, log: (event, fields) => { logs.push({ event, fields }); } };
  return { rt, calls, logs, cookies: jarCookies, config };
}

/** A same-origin browser POST. */
export function postHeaders(config: AuthConfig, extra: Record<string, string> = {}): Headers {
  return new Headers({ origin: config.siteUrl.origin, "x-real-ip": "203.0.113.7", ...extra });
}
