import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { handleDelete, readSignedInAt } from "@/lib/auth/lifecycle";
import { handleForgot, handleNewPassword, handlePasswordSignIn, handleRegister } from "@/lib/auth/password";
import { getViewer } from "@/lib/auth/viewer";
import { closePool, q } from "../helpers";
import { config, createPerson, db, freshHeaders, makeInvitation, runtimeFor, service, sessionFor, signIn } from "./kit";
import { authLink, openAuthLink, waitForMail } from "./mail";
import { randomUUID } from "node:crypto";

/**
 * Email + password on the REAL local stack: real Auth server (sign-up, confirmation email delivered to the local mailbox, password sign-in, refresh
 * tokens, password change), real database (seat reservation, redemption, profile gate, row-level security), the production handlers.
 */
afterAll(closePool);
const API = process.env.SUPABASE_API_URL as string;
const ANON = process.env.SUPABASE_ANON_KEY as string;
const GOOD = "correct horse battery staple";
const NEWPW = "a different long passphrase 7";
const address = (label: string) => `${label}-${randomUUID().slice(0, 8)}@test.invalid`;
const loc = (r: { status: number }) => (r as unknown as { location: string }).location;
const t0 = () => Date.now() - 2_000;

async function owner() {
  return createPerson({ label: "pw-owner", admin: true });
}
async function register(email: string, code: string, o: { password?: string; adult?: boolean } = {}) {
  const { rt } = runtimeFor([]);
  return handleRegister(rt, { headers: freshHeaders(), code, email, password: o.password ?? GOOD, adult: o.adult ?? true });
}
async function confirmByEmail(email: string, since = t0()) {
  const mail = await waitForMail(email, { contains: /auth\/v1\/verify/, after: since });
  return openAuthLink(authLink(mail.text));
}
async function signInWith(email: string, password: string, cookies: { name: string; value: string }[] = [], reauthUserId?: string) {
  const { rt, jar } = runtimeFor(cookies);
  const result = await handlePasswordSignIn(rt, { headers: freshHeaders(), email, password, reauthUserId });
  return { result, jar, cookies: jar.getAll() };
}
const profileOf = async (email: string) => (await q("select p.id, p.display_name, p.status from public.profiles p join auth.users u on u.id = p.id where u.email = $1", [email])).rows[0] as { id: string; display_name: string } | undefined;
const userRow = async (email: string) => (await q("select id, email_confirmed_at from auth.users where email = $1", [email])).rows[0] as { id: string; email_confirmed_at: string | null } | undefined;
const seat = async (invitationId: string) => (await q("select status, email_hash is not null as bound from public.invitation_reservations where invitation_id = $1 order by created_at", [invitationId])).rows;

describe("registering with email + password (real Auth server and mailbox)", () => {
  it("register -> confirmation email -> link -> sign in: the seat is redeemed, a profile and consents exist, and the next sign-in just works", async () => {
    const inv = await makeInvitation(await owner());
    const email = address("pw-ok");
    const since = t0();
    const r = await register(email, inv.code);
    expect(loc(r)).toBe("/auth/check-email?k=confirm");
    // not signed in, no profile, a seat held for exactly this address
    expect(await profileOf(email)).toBeUndefined();
    expect(await seat(inv.id)).toEqual([{ status: "reserved", bound: true }]);
    // before the link is opened the password does NOT sign them in
    const early = await signInWith(email, GOOD);
    expect(loc(early.result)).toBe("/signin?e=unconfirmed");
    expect(await profileOf(email)).toBeUndefined();
    // open the confirmation link from the email: it only confirms the address and lands on our "confirmed" page
    const landed = await confirmByEmail(email, since);
    expect(landed).toContain("/auth/confirmed");
    expect((await userRow(email))?.email_confirmed_at).not.toBeNull();
    expect(await profileOf(email)).toBeUndefined(); // confirming signs nobody in and creates no access
    // the first password sign-in redeems the seat
    const first = await signInWith(email, GOOD);
    expect(loc(first.result)).toBe("/account?welcome=1");
    const p = await profileOf(email);
    expect(p?.display_name).toBeTruthy();
    expect(await seat(inv.id)).toEqual([{ status: "redeemed", bound: true }]);
    expect((await q("select kind from public.consents where user_id = $1 order by kind", [p!.id])).rows.map((x) => x.kind)).toEqual(["adult_confirmation", "privacy_notice"]);
    // and that session is a real learner session
    expect((await getViewer(sessionFor(first.cookies).client)).kind).toBe("learner");
    // later sign-ins need no seat
    expect(loc((await signInWith(email, GOOD)).result)).toBe("/account");
    expect(loc((await signInWith(email, "a wrong password entirely")).result)).toBe("/signin?e=credentials");
  });

  it("DIRECT use of the public Auth API creates nothing usable: sign-up, confirmed address, password sign-in, and still no access to anything", async () => {
    const anon = createClient(API, ANON, { auth: { persistSession: false } });
    const email = address("pw-direct");
    const since = t0();
    const up = await anon.auth.signUp({ email, password: GOOD });
    expect(up.error).toBeNull();
    expect(up.data.session).toBeNull(); // confirmation is required: no session from sign-up
    await openAuthLink(authLink((await waitForMail(email, { contains: /auth\/v1\/verify/, after: since })).text));
    const inn = await anon.auth.signInWithPassword({ email, password: GOOD });
    expect(inn.error).toBeNull(); // the Auth API itself will sign a confirmed address in...
    const token = inn.data.session!.access_token;
    // ...but a person with no profile is nobody to the application and to the database
    for (const path of ["/rest/v1/profiles?select=*", "/rest/v1/consents?select=*", "/rest/v1/learner_documents?select=*", "/rest/v1/invitations?select=*", "/rest/v1/audit_events?select=*"]) {
      const res = await fetch(`${API}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
      const body = res.status === 200 ? await res.json() : [];
      expect(body, path).toEqual([]);
    }
    for (const fn of ["reserve_invitation_for_email", "redeem_reservation_for_email", "email_identity_state", "put_document", "delete_learner"]) {
      const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      expect([401, 403, 404], fn).toContain(res.status);
    }
    const put = await fetch(`${API}/rest/v1/profiles`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: inn.data.user!.id, display_name: "x", adult_confirmed_at: new Date().toISOString() }) });
    expect([401, 403]).toContain(put.status); // nobody can write their own profile into existence
    expect(await profileOf(email)).toBeUndefined();
    // through OUR sign-in the same person is refused and the leftover deleted
    const viaApp = await signInWith(email, GOOD);
    expect(loc(viaApp.result)).toBe("/signin?e=noaccount");
    expect(await userRow(email)).toBeUndefined();
  });

  it("the seat belongs to the address it was reserved for: another confirmed address cannot take it", async () => {
    const inv = await makeInvitation(await owner());
    const mine = address("pw-seat-a");
    const other = address("pw-seat-b");
    const since = t0();
    expect(loc(await register(mine, inv.code))).toBe("/auth/check-email?k=confirm");
    // someone else confirms their own address directly and signs in: they hold no seat
    const anon = createClient(API, ANON, { auth: { persistSession: false } });
    await anon.auth.signUp({ email: other, password: GOOD });
    await openAuthLink(authLink((await waitForMail(other, { contains: /auth\/v1\/verify/, after: since })).text));
    expect(loc((await signInWith(other, GOOD)).result)).toBe("/signin?e=noaccount");
    expect(await profileOf(other)).toBeUndefined();
    expect(await seat(inv.id)).toEqual([{ status: "reserved", bound: true }]); // still waiting for the right address
    await confirmByEmail(mine, since);
    expect(loc((await signInWith(mine, GOOD)).result)).toBe("/account?welcome=1");
  });

  it("a one-seat invitation can be used by ONE address; the code cannot be reused, a revoked or expired invitation is refused", async () => {
    const adm = await owner();
    const inv = await makeInvitation(adm);
    expect(loc(await register(address("pw-one-a"), inv.code))).toBe("/auth/check-email?k=confirm");
    expect(loc(await register(address("pw-one-b"), inv.code))).toBe("/join/email?e=full");
    const inv2 = await makeInvitation(adm);
    await q("update public.invitations set revoked_at = now() where id = $1", [inv2.id]);
    expect(loc(await register(address("pw-rev"), inv2.code))).toBe("/join/email?e=revoked");
    expect(loc(await register(address("pw-bad"), "ABCD-EFGH-JKMN"))).toBe("/join/email?e=invite");
    // an invitation revoked AFTER registering but before the first sign-in no longer redeems
    const inv3 = await makeInvitation(adm);
    const email = address("pw-revoked-late");
    const since = t0();
    await register(email, inv3.code);
    await confirmByEmail(email, since);
    await q("update public.invitations set revoked_at = now() where id = $1", [inv3.id]);
    await q("update public.invitation_reservations set status = 'revoked' where invitation_id = $1 and status = 'reserved'", [inv3.id]);
    expect(loc((await signInWith(email, GOOD)).result)).toBe("/signin?e=noaccount");
    expect(await profileOf(email)).toBeUndefined();
  });

  it("an expired hold cannot be redeemed", async () => {
    const inv = await makeInvitation(await owner());
    const email = address("pw-expired");
    const since = t0();
    await register(email, inv.code);
    await confirmByEmail(email, since);
    await q("update public.invitation_reservations set expires_at = now() - interval '1 minute' where invitation_id = $1", [inv.id]);
    expect(loc((await signInWith(email, GOOD)).result)).toBe("/signin?e=noaccount");
    expect(await profileOf(email)).toBeUndefined();
  });

  it("weak passwords, a missing 18+ box and a bad address are refused before any account or seat exists", async () => {
    const inv = await makeInvitation(await owner(), { maxUses: 5 });
    const email = address("pw-weak");
    expect(loc(await register(email, inv.code, { password: "short" }))).toBe("/join/email?e=pw_short");
    expect(loc(await register(email, inv.code, { password: "Password1234" }))).toBe("/join/email?e=pw_common");
    expect(loc(await register(email, inv.code, { adult: false }))).toBe("/join/email?e=adult");
    expect(loc(await register("not-an-address", inv.code))).toBe("/join/email?e=email");
    expect(await userRow(email)).toBeUndefined();
    expect(await seat(inv.id)).toEqual([]);
  });

  it("an address that already belongs to a learner (email OR Google) cannot be registered, and nothing of theirs is touched", async () => {
    const adm = await owner();
    const inv = await makeInvitation(adm, { maxUses: 5 });
    const g = await createPerson({ label: "pw-google-owner", learner: true }); // a Google learner
    expect(loc(await register(g.email, inv.code))).toBe("/join/email?e=taken");
    expect((await q("select count(*)::int n from auth.users where id = $1", [g.id])).rows[0].n).toBe(1);
    expect((await q("select count(*)::int n from auth.identities where user_id = $1 and provider = 'google'", [g.id])).rows[0].n).toBe(1);
    // an email learner
    const email = address("pw-existing");
    const since = t0();
    await register(email, inv.code);
    await confirmByEmail(email, since);
    await signInWith(email, GOOD);
    const before = await profileOf(email);
    expect(loc(await register(email, inv.code, { password: "attacker chosen long password" }))).toBe("/join/email?e=taken");
    expect(await profileOf(email)).toEqual(before);
    expect(loc((await signInWith(email, GOOD)).result)).toBe("/account"); // the real password still works
    expect(loc((await signInWith(email, "attacker chosen long password")).result)).toBe("/signin?e=credentials");
  });

  it("a squatter who pre-registered the address through the public Auth API gets nothing, and the invited person's pending registration is never deleted by another registration; only the age-based sweep clears a stale leftover", async () => {
    const inv = await makeInvitation(await owner());
    const email = address("pw-squat");
    const anon = createClient(API, ANON, { auth: { persistSession: false } });
    await anon.auth.signUp({ email, password: "squatters password is long" }); // unconfirmed, profile-less, someone else's choice of password
    const squatterId = (await userRow(email))!.id;
    // a registration presenting the same address does not delete that user, reserves no seat and signs nobody up
    expect(loc(await register(email, inv.code))).toBe("/join/email?e=taken");
    expect((await userRow(email))!.id).toBe(squatterId);
    expect(await seat(inv.id)).toEqual([]);
    // the squatter's password gives no access (unconfirmed, and no profile either way)
    expect(loc((await signInWith(email, "squatters password is long")).result)).toBe("/signin?e=unconfirmed");
    expect(await profileOf(email)).toBeUndefined();
    // a young leftover survives the sweep; once it is older than the hold, the sweep removes it and the invited person can register
    await service.rpc("purge_orphan_identities", { p_older: "25 hours" });
    expect((await userRow(email))?.id).toBe(squatterId);
    await q("update auth.users set created_at = now() - interval '26 hours' where id = $1", [squatterId]);
    await service.rpc("purge_orphan_identities", { p_older: "25 hours" });
    expect(await userRow(email)).toBeUndefined();
    const since = t0();
    expect(loc(await register(email, inv.code))).toBe("/auth/check-email?k=confirm");
    await confirmByEmail(email, since);
    expect(loc((await signInWith(email, "squatters password is long")).result)).toBe("/signin?e=credentials");
    expect(loc((await signInWith(email, GOOD)).result)).toBe("/account?welcome=1");
  });

  it("a Google learner and an email learner are separate people: different ids, isolated rows, neither can read the other's data", async () => {
    const adm = await owner();
    const inv = await makeInvitation(adm);
    const email = address("pw-iso");
    const since = t0();
    await register(email, inv.code);
    await confirmByEmail(email, since);
    const mine = await signInWith(email, GOOD);
    const g = await createPerson({ label: "pw-iso-google", learner: true });
    const me = (await profileOf(email))!;
    await q("insert into public.consents (user_id, kind, version) values ($1, 'cloud_storage', 'test')", [me.id]);
    await q("select * from public.put_document($1, 'lessons_v2', 0, 2, $2::jsonb)", [me.id, JSON.stringify({ version: 2, sessions: [], onboarding: { status: "skipped" }, marker: "EMAIL-LEARNER-DATA" })]).catch(() => undefined);
    const theirs = await sessionFor(g.cookies).client.from("learner_documents").select("*");
    expect(JSON.stringify(theirs.data ?? [])).not.toContain("EMAIL-LEARNER-DATA");
    const mineRows = await sessionFor(mine.cookies).client.from("profiles").select("id");
    expect((mineRows.data ?? []).map((r: { id: string }) => r.id)).toEqual([me.id]);
    expect(me.id).not.toBe(g.id);
  });
});

describe("password guessing and sign-in limits", () => {
  it("the ninth guess at one address within ten minutes is refused (even with the right password), from any address", async () => {
    const email = address("pw-guess");
    for (let i = 0; i < 8; i++) expect(loc((await signInWith(email, `wrong guess number ${i}`)).result)).toBe("/signin?e=credentials");
    const ninth = await signInWith(email, GOOD);
    expect(loc(ninth.result)).toBe("/signin?e=rate");
    expect((ninth.result as { retryAfter?: number }).retryAfter).toBeGreaterThan(0);
  });
});

describe("forgot password and choosing a new one", () => {
  async function learner(label: string) {
    const inv = await makeInvitation(await owner());
    const email = address(label);
    const since = t0();
    await register(email, inv.code);
    await confirmByEmail(email, since);
    const s = await signInWith(email, GOOD);
    return { email, id: (await profileOf(email))!.id, cookies: s.cookies };
  }
  it("a reset email is sent ONLY for an email learner; Google learners, strangers and unconfirmed addresses get the same answer and no email", async () => {
    const a = await learner("pw-forgot");
    const g = await createPerson({ label: "pw-forgot-google", learner: true });
    const stranger = address("pw-stranger");
    const since = t0();
    for (const e of [a.email, g.email, stranger]) {
      const { rt } = runtimeFor([]);
      expect(await handleForgot(rt, { headers: freshHeaders(), email: e })).toMatchObject({ status: 303, location: "/auth/check-email?k=reset" });
    }
    const mail = await waitForMail(a.email, { contains: /auth\/v1\/verify/, after: since });
    expect(mail.text).toContain("type=recovery");
    await new Promise((r) => setTimeout(r, 1_500));
    for (const e of [g.email, stranger]) await expect(waitForMail(e, { after: since, timeoutMs: 1_500 })).rejects.toThrow(/no email/);
  });
  it("the whole reset: link -> session in the same browser -> new password -> every old session is dead -> old password refused, new one works", async () => {
    const a = await learner("pw-reset");
    const since = t0();
    const { rt: rt0, jar } = runtimeFor([]); // the browser that asks for the reset (it keeps the PKCE verifier)
    await handleForgot(rt0, { headers: freshHeaders(), email: a.email });
    const mail = await waitForMail(a.email, { contains: /type=recovery/, after: since });
    const back = await openAuthLink(authLink(mail.text));
    const url = new URL(back);
    expect(url.pathname).toBe("/api/auth/recover");
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    // an old session on another device, and the recovery session in the asking browser
    const device2 = await signInWith(a.email, GOOD);
    const { rt: rt1, jar: jar1 } = runtimeFor(jar.getAll(), { exchange: "real" });
    const { handleRecover } = await import("@/lib/auth/password");
    expect(await handleRecover(rt1, { code })).toMatchObject({ location: "/auth/new-password" });
    // a link opened in a DIFFERENT browser (no verifier) does nothing useful
    const { rt: rtOther } = runtimeFor([], { exchange: "real" });
    expect(await handleRecover(rtOther, { code })).toMatchObject({ location: "/auth/error?r=recover" });
    const { rt: rt2, jar: jar2 } = runtimeFor(jar1.getAll());
    expect(await handleNewPassword(rt2, { headers: freshHeaders(), password: NEWPW, confirm: NEWPW })).toMatchObject({ location: "/signin?e=pwchanged" });
    expect(jar2.getAll().length).toBe(0);
    // every session of this person is gone
    expect((await getViewer(sessionFor(device2.cookies).client)).kind).toBe("anonymous");
    expect((await signInWith(a.email, GOOD)).result).toMatchObject({ location: "/signin?e=credentials" });
    expect((await signInWith(a.email, NEWPW)).result).toMatchObject({ location: "/account" });
  });
  it("a new password is refused without a session, for a mismatch, and when weak; nothing changes", async () => {
    const a = await learner("pw-newpw");
    const { rt: anon } = runtimeFor([]);
    expect(await handleNewPassword(anon, { headers: freshHeaders(), password: NEWPW, confirm: NEWPW })).toMatchObject({ location: "/signin?e=session" });
    const { rt } = runtimeFor(a.cookies);
    expect(await handleNewPassword(rt, { headers: freshHeaders(), password: NEWPW, confirm: "other" })).toMatchObject({ location: "/auth/new-password?e=mismatch" });
    expect(await handleNewPassword(rt, { headers: freshHeaders(), password: "short", confirm: "short" })).toMatchObject({ location: "/auth/new-password?e=pw_short" });
    expect(loc((await signInWith(a.email, GOOD)).result)).toBe("/account");
  });
});

describe("account deletion for an email learner", () => {
  async function learnerWithSession() {
    const inv = await makeInvitation(await owner());
    const email = address("pw-del");
    const since = t0();
    await register(email, inv.code);
    await confirmByEmail(email, since);
    const s = await signInWith(email, GOOD);
    return { email, id: (await profileOf(email))!.id, cookies: s.cookies };
  }
  const deps = async (cookies: { name: string; value: string }[], over: Record<string, unknown> = {}) => {
    const { client } = sessionFor(cookies);
    const viewer = await getViewer(client);
    return { config, viewer, client, service, limiter: db.limiter, headers: freshHeaders(), signedInAt: await readSignedInAt(client), now: () => Date.now(), log: () => undefined, endSession: () => undefined, ...over };
  };
  it("a fresh password sign-in allows deletion (typed words still required), a stale one asks to confirm with the password, and re-confirming must be the SAME account", async () => {
    const a = await learnerWithSession();
    const stale = await deps(a.cookies, { signedInAt: Math.floor(Date.now() / 1000) - 3_600 });
    expect(await handleDelete(stale as never, { confirm: "delete my account" })).toMatchObject({ status: 403, body: { error: "reauth_required" } });
    // confirming with the password again mints a fresh sign-in for the same account
    const again = await signInWith(a.email, GOOD, a.cookies, a.id);
    expect(loc(again.result)).toBe("/account/delete");
    // someone ELSE's password cannot stand in
    const other = await createPerson({ label: "pw-del-other", learner: true });
    const wrong = await signInWith(a.email, GOOD, other.cookies, other.id);
    expect(loc(wrong.result)).toBe("/account/delete?e=credentials");
    const fresh = await deps(again.cookies);
    expect(await handleDelete(fresh as never, { confirm: "delete my account" })).toMatchObject({ status: 200, body: { deleted: true } });
    expect((await q("select count(*)::int n from auth.users where id = $1", [a.id])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.profiles where id = $1", [a.id])).rows[0].n).toBe(0);
    expect(loc((await signInWith(a.email, GOOD)).result)).toBe("/signin?e=credentials"); // nothing to sign in to
  });
  void signIn;
});
