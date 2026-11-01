import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAuthConfig, type AuthConfig } from "@/lib/auth/config";
import { CookieSession } from "@/lib/auth/cookie-session";
import { accountDb, type AccountDb } from "@/lib/auth/db";
import type { AdminDeps } from "@/lib/auth/admin";
import { createInvitation } from "@/lib/auth/admin";
import { handleCallback } from "@/lib/auth/callback";
import { handleJoin, handleSignIn } from "@/lib/auth/handlers";
import { flowJar, sessionAuth, type AuthRuntime } from "@/lib/auth/runtime";
import { createServiceClient, createSessionClient } from "@/lib/auth/supabase";
import { getViewer } from "@/lib/auth/viewer";
import { q } from "../helpers";

/**
 * Integration kit. Everything here is REAL except Google's own consent screen (it cannot run locally):
 *  - sessions come from the real Auth server and are carried in cookies written by the production cookie code;
 *  - `getUser` is answered by the real Auth server; profile, RLS, invitations and cleanup are the real database;
 *  - the Google identity a person would have after consenting is created directly (a `google` row in auth.identities).
 * The code exchange is the one call replaced, because it needs a code only Google can issue.
 */
const API = process.env.SUPABASE_API_URL as string;
const state = loadAuthConfig({
  NEXT_PUBLIC_ACCOUNTS: "on",
  SUPABASE_URL: API,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  INVITE_CODE_PEPPER: "integration-test-pepper-integration-test",
  AUTH_FLOW_SECRET: "integration-test-flow-secret-integration",
  AUTH_SITE_URL: "http://localhost:3100",
  CRON_SECRET: "integration-test-cron-secret-integration",
});
if (state.state !== "ready") throw new Error("integration config not ready: " + JSON.stringify(state));
export const config: AuthConfig = state.config;
export const service: SupabaseClient = createServiceClient(config);
export const db: AccountDb = accountDb(service);

const PASSWORD = "Local-only-test-password-1!";
export type Cookies = { name: string; value: string }[];
export type Person = { id: string; email: string; cookies: Cookies };

export async function createPerson(o: { label?: string; google?: boolean; learner?: boolean; admin?: boolean; providers?: string[]; email?: string } = {}): Promise<Person> {
  const label = o.label ?? "person";
  const email = o.email ?? `${label}-${randomUUID().slice(0, 8)}@test.invalid`;
  const google = o.google ?? true;
  const created = await service.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    app_metadata: google ? { provider: "google", providers: o.providers ?? ["google"] } : undefined,
    user_metadata: { full_name: `Test ${label}` },
  });
  if (created.error || !created.data.user) throw new Error("createUser: " + created.error?.message);
  const id = created.data.user.id;
  if (google) {
    // The state after Google consent: a single verified google identity (the email identity GoTrue added for the password is removed).
    await q("delete from auth.identities where user_id = $1", [id]);
    await q("insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), $2, $1, $3::jsonb, 'google', now(), now(), now())",
      [id, `google-${id}`, JSON.stringify({ sub: `google-${id}`, email, email_verified: true })]);
    for (const extra of (o.providers ?? []).filter((p) => p !== "google")) {
      await q("insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), $2, $1, $3::jsonb, $4, now(), now(), now())",
        [id, `${extra}-${id}`, JSON.stringify({ sub: `${extra}-${id}`, email, email_verified: true }), extra]);
    }
  }
  if (o.learner || o.admin) {
    await q("insert into public.profiles (id, display_name, adult_confirmed_at) values ($1, $2, now())", [id, `Test ${label}`]);
    await q("insert into public.consents (user_id, kind, version) values ($1, 'adult_confirmation', 'test')", [id]);
  }
  if (o.admin) await q("insert into public.app_admins (user_id) values ($1)", [id]);
  return { id, email, cookies: await signIn(email) };
}

/** A real password sign-in through the production session client: the cookies are exactly what a browser would hold. */
export async function signIn(email: string): Promise<Cookies> {
  const jar = new CookieSession([]);
  const client = createSessionClient(config, jar);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error("signIn: " + error.message);
  return jar.getAll();
}

export function sessionFor(cookies: Cookies): { jar: CookieSession; client: SupabaseClient } {
  const jar = new CookieSession(cookies);
  return { jar, client: createSessionClient(config, jar) };
}
export const viewerOf = (p: Person) => getViewer(sessionFor(p.cookies).client);

export type RtOptions = { db?: Partial<AccountDb>; exchange?: "ok" | "fail" | "real" };
/** A runtime on real clients. The code exchange is stubbed (it needs a code from Google) unless `exchange: "real"`, which uses the real Auth server and the PKCE verifier in the cookies (the password-reset link). */
export function runtimeFor(cookies: Cookies, o: RtOptions = {}) {
  const { jar, client } = sessionFor(cookies);
  const real = sessionAuth(client);
  const rt: AuthRuntime = {
    config,
    db: { ...db, ...o.db },
    auth: o.exchange === "real" ? real : { ...real, exchangeCodeForSession: async () => ({ ok: o.exchange !== "fail" }) },
    jar: flowJar(config, jar),
    now: () => Date.now(),
    log: () => undefined,
  };
  return { rt, jar };
}

let ipCounter = 0;
/** A browser POST from a fresh address, so tests about seats are not throttled by the per-address limit. */
export const freshHeaders = () => new Headers({ origin: config.siteUrl.origin, "x-real-ip": `198.51.100.${(ipCounter++ % 250) + 1}-${randomUUID().slice(0, 6)}` });

/** Creates an invitation the way the owner does (through the admin code path) and returns the plaintext code and its id. */
export async function makeInvitation(admin: Person, o: { maxUses?: number; expiresInDays?: number; label?: string } = {}): Promise<{ id: string; code: string }> {
  const out = await createInvitation(await adminDeps(admin), { label: o.label ?? "test", maxUses: o.maxUses ?? 1, expiresInDays: o.expiresInDays ?? 7 });
  if (out.status !== 201) throw new Error("createInvitation: " + JSON.stringify(out));
  const body = out.body as { id: string; code: string };
  return { id: body.id, code: body.code };
}

export async function adminDeps(admin: Person, headers = freshHeaders()): Promise<AdminDeps> {
  const { client } = sessionFor(admin.cookies);
  return { config, viewer: await getViewer(client), service, limiter: db.limiter, headers, now: () => Date.now() };
}

function carried(jar: CookieSession, result: { status: number }) {
  const flow = jar.outgoing.get(config.cookieNames.flow);
  const location = "location" in result ? (result as { location: string }).location : null;
  const nonce = location && location.startsWith("http") ? new URL(new URL(location).searchParams.get("redirect_to") as string).searchParams.get("flow") : null;
  return { result, location, flowCookie: flow && flow.options.maxAge !== 0 ? flow.value : null, nonce };
}

/** Starts a join with the real handler, then returns what the browser would carry into the callback: the flow cookie and its nonce. */
export async function startJoin(code: string, o: { adult?: boolean; headers?: Headers } = {}) {
  const { rt, jar } = runtimeFor([]);
  return carried(jar, await handleJoin(rt, { headers: o.headers ?? freshHeaders(), code, adult: o.adult ?? true }));
}

/** Starts a plain sign-in (no invitation) with the real handler. */
export async function startSignIn(o: { headers?: Headers } = {}) {
  const { rt, jar } = runtimeFor([]);
  return carried(jar, await handleSignIn(rt, { headers: o.headers ?? freshHeaders() }));
}

/** Plays the callback for a person who is already holding a session (as they would be after the exchange). */
export async function callback(person: Person, flow: { flowCookie: string | null; nonce: string | null }, o: RtOptions = {}) {
  const cookies = [...person.cookies, ...(flow.flowCookie ? [{ name: config.cookieNames.flow, value: flow.flowCookie }] : [])];
  const { rt, jar } = runtimeFor(cookies, o);
  const result = await handleCallback(rt, { code: "code-issued-by-google", providerError: null, flowParam: flow.nonce });
  return { ...result, jar };
}

export async function authUserExists(id: string): Promise<boolean> {
  return (await q("select 1 from auth.users where id = $1", [id])).rowCount === 1;
}
export async function profileOf(id: string) {
  return (await q("select * from public.profiles where id = $1", [id])).rows[0] as { id: string; display_name: string; status: string; joined_via_invitation: string | null } | undefined;
}
export async function counts(invitationId: string) {
  const r = (await q("select reserved_count, redeemed_count, max_uses from public.invitations where id = $1", [invitationId])).rows[0];
  const real = (await q("select count(*) filter (where status = 'reserved')::int as reserved, count(*) filter (where status = 'redeemed')::int as redeemed from public.invitation_reservations where invitation_id = $1", [invitationId])).rows[0];
  return { reserved: r.reserved_count as number, redeemed: r.redeemed_count as number, max: r.max_uses as number, rowsReserved: real.reserved as number, rowsRedeemed: real.redeemed as number };
}
