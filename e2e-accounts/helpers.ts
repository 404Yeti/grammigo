import { randomUUID } from "node:crypto";
import pg from "pg";
import { codeHint, formatCode, generateCode, hashCode } from "../src/lib/auth/invite-code";

/**
 * Helpers for the accounts browser tests. Google's consent screen cannot run locally, so a person who "has already signed in with
 * Google" is created directly on the local stack (real Auth user, a google identity row, optionally a profile) and handed to the
 * browser as the exact session cookie the app would have written. Everything the app does with that cookie is real.
 */
export const PORT = Number(process.env.E2E_ACCOUNTS_PORT ?? 3100);
export const BASE = `http://localhost:${PORT}`;
const API = process.env.SUPABASE_API_URL as string;
const ANON = process.env.SUPABASE_ANON_KEY as string;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const PEPPER = Buffer.from(process.env.INVITE_CODE_PEPPER as string);
const PASSWORD = "Local-only-test-password-1!";
export const COOKIE = "gm-auth"; // plain names on http://localhost (the __Host- prefix needs https)
export const FLOW_COOKIE = "gm-flow";

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 3 });
export const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

async function gotrue(path: string, body: unknown, key = ANON, token?: string) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type Account = { id: string; email: string; name: string; session: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function createAccount(o: { name: string; learner?: boolean; admin?: boolean }): Promise<Account> {
  const email = `${o.name.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}@test.invalid`;
  const made = await gotrue("/auth/v1/admin/users", { email, password: PASSWORD, email_confirm: true, app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { full_name: o.name } }, SERVICE);
  if (made.status >= 300) throw new Error("create user: " + JSON.stringify(made.json));
  const id = made.json.id as string;
  await q("delete from auth.identities where user_id = $1", [id]);
  await q("insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), $2, $1, $3::jsonb, 'google', now(), now(), now())", [id, `google-${id}`, JSON.stringify({ sub: `google-${id}`, email, email_verified: true })]);
  if (o.learner || o.admin) {
    await q("insert into public.profiles (id, display_name, adult_confirmed_at) values ($1, $2, now())", [id, o.name]);
    await q("insert into public.consents (user_id, kind, version) values ($1, 'adult_confirmation', 'e2e')", [id]);
  }
  if (o.admin) await q("insert into public.app_admins (user_id) values ($1)", [id]);
  const login = await gotrue("/auth/v1/token?grant_type=password", { email, password: PASSWORD });
  if (login.status !== 200) throw new Error("sign in: " + JSON.stringify(login.json));
  return { id, email, name: o.name, session: login.json };
}

/** Signs the same person in again (a new session, as after any sign-out). */
export async function signInAgain(a: Account): Promise<Account> {
  const login = await gotrue("/auth/v1/token?grant_type=password", { email: a.email, password: PASSWORD });
  if (login.status !== 200) throw new Error("sign in again: " + JSON.stringify(login.json));
  return { ...a, session: login.json };
}

/** Marks onboarding as skipped in THIS account's own saved-progress folder before the app loads (the guest's folder is never touched). */
export async function seedAccountLearner(page: import("@playwright/test").Page, accountId: string) {
  await page.addInitScript((id) => {
    const key = `grammigo:v2:u:${id}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify({ version: 2, sessions: [], activeSessionId: null, onboarding: { status: "skipped", step: "welcome", draftText: "", draftSource: "typed", runId: null, startedAt: null, completedAt: null }, goals: null, diagnosticRuns: [], lastRecommendation: null, writingFeedback: {} }));
  }, accountId);
}

const CHUNK = 3180; // @supabase/ssr's MAX_CHUNK_SIZE: a cookie value longer than this is split into name.0, name.1, ...

/**
 * The browser cookies for a session, in exactly the format @supabase/ssr writes: the full session JSON, base64url, behind the
 * "base64-" prefix, split into chunks past 3180 characters. `expired` makes the stored expiry past, so the app must refresh it.
 */
export function sessionCookies(a: Account, o: { expired?: boolean; refreshToken?: string; accessToken?: string } = {}) {
  const s = {
    access_token: o.accessToken ?? a.session.access_token,
    refresh_token: o.refreshToken ?? a.session.refresh_token,
    token_type: "bearer",
    expires_in: o.expired ? 0 : 3600,
    expires_at: o.expired ? Math.floor(Date.now() / 1000) - 60 : Math.floor(Date.now() / 1000) + 3600,
    user: a.session.user,
  };
  return cookiesFor("base64-" + Buffer.from(JSON.stringify(s)).toString("base64url"));
}

/** Splits a raw cookie value the way the app does, so tests can also store a damaged value. */
export function cookiesFor(value: string) {
  const parts = value.length <= CHUNK ? [value] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => value.slice(i * CHUNK, (i + 1) * CHUNK));
  return parts.map((v, i) => ({ name: parts.length === 1 ? COOKIE : `${COOKIE}.${i}`, value: v, url: BASE, httpOnly: true, sameSite: "Lax" as const }));
}

export async function revokeSessions(a: Account) {
  const r = await fetch(`${API}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${a.session.access_token}` } });
  if (r.status >= 300) throw new Error("logout failed: " + r.status);
}

/** An invitation made the way the owner's tool makes one. Returns the code a person would type. */
export async function invitation(o: { maxUses?: number; expiresInSeconds?: number; revoked?: boolean } = {}): Promise<{ code: string; id: string }> {
  const code = generateCode();
  const { rows } = await q("insert into public.invitations (label, code_hash, code_hint, max_uses, expires_at, revoked_at) values ('e2e', $1, $2, $3, now() + ($4 || ' seconds')::interval, $5) returning id", [hashCode(code, PEPPER), codeHint(code), o.maxUses ?? 1, String(o.expiresInSeconds ?? 3600), o.revoked ? new Date().toISOString() : null]);
  return { code: formatCode(code), id: rows[0].id as string };
}

let n = 0;
/** A distinct client address per call, so one test's requests never use up another's rate-limit budget. */
export const uniqueIp = () => `192.0.2.${(n++ % 250) + 1}-${randomUUID().slice(0, 8)}`;
export const browserHeaders = (ip = uniqueIp()) => ({ origin: BASE, "x-real-ip": ip });

export async function resetRateLimits() {
  await q("truncate public.rate_limits");
}
