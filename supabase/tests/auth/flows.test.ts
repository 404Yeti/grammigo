import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvitation, listInvitations, revokeInvitation } from "@/lib/auth/admin";
import { runCleanup } from "@/lib/auth/cleanup";
import { newNonce, signFlow } from "@/lib/auth/flow";
import { hashCode, normaliseCode } from "@/lib/auth/invite-code";
import { closePool, q } from "../helpers";
import {
  adminDeps, authUserExists, callback, config, counts, createPerson, db, freshHeaders, makeInvitation, profileOf, runtimeFor, service, sessionFor, signIn, startJoin, startSignIn, viewerOf, type Person,
} from "./kit";

/**
 * End-to-end account flows on the REAL local stack: real Auth sessions, real row-level security, real invitation functions.
 * Only Google's consent screen is replaced (see kit.ts).
 */
let admin: Person;
beforeAll(async () => {
  await q("truncate public.rate_limits"); // counters persist between runs; start from a clean budget
  admin = await createPerson({ label: "owner", learner: true, admin: true });
});
afterAll(closePool);

/** Changes one character well inside the value (a change at the very end can land in base64 padding bits and decode to the same bytes). */
const corruptMiddle = (v: string) => v.slice(0, 50) + (v[50] === "A" ? "B" : "A") + v.slice(51);
const redirectOf = (r: { result: { status: number } & Record<string, unknown> }) => (r.result as { location?: string }).location;

describe("successful invitation", () => {
  it("a new Google identity with a valid code becomes a learner: one profile, two consents, one redeemed seat, audit rows without personal data", async () => {
    const inv = await makeInvitation(admin);
    const started = await startJoin(inv.code);
    expect(started.result.status).toBe(303);
    expect(new URL(started.location as string).origin).toBe(new URL(config.supabaseUrl).origin);
    expect(started.flowCookie).toBeTruthy();
    expect(await counts(inv.id)).toMatchObject({ reserved: 1, redeemed: 0, rowsReserved: 1 });

    const ana = await createPerson({ label: "ana" });
    expect((await viewerOf(ana)).kind).toBe("no_profile"); // before redemption: a session, but no access
    const done = await callback(ana, started);
    expect(done).toMatchObject({ outcome: "joined", redirect: "/account?welcome=1" });

    expect(await profileOf(ana.id)).toMatchObject({ display_name: "Test ana", status: "active", joined_via_invitation: inv.id });
    expect((await q("select kind from public.consents where user_id = $1 order by kind", [ana.id])).rows.map((r) => r.kind)).toEqual(["adult_confirmation", "privacy_notice"]);
    expect(await counts(inv.id)).toMatchObject({ reserved: 1, redeemed: 1, rowsRedeemed: 1 });
    const v = await viewerOf(ana);
    expect(v).toMatchObject({ kind: "learner", displayName: "Test ana", isAdmin: false });

    const audit = (await q("select kind, meta from public.audit_events where kind in ('invite_created','invite_reserved','invite_redeemed') and meta->>'invitation' = $1", [inv.id])).rows;
    expect(audit.map((a) => a.kind).sort()).toEqual(["invite_created", "invite_redeemed", "invite_reserved"]);
    expect(JSON.stringify(audit)).not.toContain(ana.email);
    expect(JSON.stringify(audit)).not.toContain(inv.code);
  });

  it("the stored invitation holds only an HMAC, never the code", async () => {
    const inv = await makeInvitation(admin);
    const row = (await q("select code_hash, code_hint from public.invitations where id = $1", [inv.id])).rows[0];
    const code = normaliseCode(inv.code) as string;
    expect(Buffer.from(row.code_hash).equals(hashCode(code, config.pepper))).toBe(true);
    expect(Buffer.from(row.code_hash).toString("utf8")).not.toContain(code);
    expect(row.code_hint).toBe(code.slice(-4));
  });
});

describe("invalid, expired and revoked invitations", () => {
  it("an unknown code is refused, reserves nothing and starts no Google sign-in", async () => {
    const before = (await q("select count(*)::int as n from public.invitation_reservations")).rows[0].n;
    const s = await startJoin("ABCDEFGHJKM");
    expect(redirectOf(s)).toBe("/join?e=invite");
    expect(s.flowCookie).toBeNull();
    expect((await q("select count(*)::int as n from public.invitation_reservations")).rows[0].n).toBe(before);
  });

  it("an expired invitation is refused with its own message", async () => {
    const inv = await makeInvitation(admin);
    await q("update public.invitations set expires_at = now() - interval '1 minute' where id = $1", [inv.id]);
    expect(redirectOf(await startJoin(inv.code))).toBe("/join?e=expired");
  });

  it("a revoked invitation is refused, and revoking is owner-only", async () => {
    const inv = await makeInvitation(admin);
    const rando = await createPerson({ label: "rando", learner: true });
    expect((await revokeInvitation(await adminDeps(rando), inv.id)).status).toBe(403);
    expect(redirectOf(await startJoin(inv.code))).not.toBe("/join?e=revoked");
    const inv2 = await makeInvitation(admin);
    expect((await revokeInvitation(await adminDeps(admin), inv2.id)).status).toBe(200);
    expect(redirectOf(await startJoin(inv2.code))).toBe("/join?e=revoked");
  });

  it("an invitation with no seats left is refused as full", async () => {
    const inv = await makeInvitation(admin, { maxUses: 1 });
    expect((await startJoin(inv.code)).flowCookie).toBeTruthy();
    expect(redirectOf(await startJoin(inv.code))).toBe("/join?e=full");
  });

  it("no 18+ confirmation, no reservation", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code, { adult: false });
    expect(redirectOf(s)).toBe("/join?e=adult");
    expect(await counts(inv.id)).toMatchObject({ reserved: 0 });
  });

  it("an invitation that EXPIRES while the person is at Google creates no learner and removes the identity", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    await q("update public.invitation_reservations set expires_at = now() - interval '1 second' where invitation_id = $1", [inv.id]);
    const late = await createPerson({ label: "late" });
    const r = await callback(late, s);
    expect(r).toMatchObject({ outcome: "invite_unusable", redirect: "/join?e=expired" });
    expect(await profileOf(late.id)).toBeUndefined();
    expect(await authUserExists(late.id)).toBe(false);
  });

  it("an invitation REVOKED while the person is at Google creates no learner and removes the identity", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    await revokeInvitation(await adminDeps(admin), inv.id);
    const p = await createPerson({ label: "revoked-mid" });
    // Revoking cancels the pending reservation itself, so the redemption sees a grant that is no longer valid (not a "revoked" code).
    expect(await callback(p, s)).toMatchObject({ outcome: "invite_unusable", redirect: "/join?e=invite" });
    expect(await profileOf(p.id)).toBeUndefined();
    expect(await authUserExists(p.id)).toBe(false);
  });

  it("revoking keeps accounts that already joined working", async () => {
    const inv = await makeInvitation(admin, { maxUses: 2 });
    const s = await startJoin(inv.code);
    const joined = await createPerson({ label: "joined-before" });
    await callback(joined, s);
    await revokeInvitation(await adminDeps(admin), inv.id);
    expect((await viewerOf(joined)).kind).toBe("learner");
  });
});

describe("usage limits and atomic redemption under concurrency", () => {
  it("15 simultaneous joins on a 4-seat invitation reserve exactly 4 seats", async () => {
    const inv = await makeInvitation(admin, { maxUses: 4 });
    const results = await Promise.all(Array.from({ length: 15 }, () => startJoin(inv.code)));
    expect(results.filter((r) => r.flowCookie).length).toBe(4);
    expect(results.filter((r) => redirectOf(r) === "/join?e=full").length).toBe(11);
    expect(await counts(inv.id)).toMatchObject({ reserved: 4, rowsReserved: 4, redeemed: 0 });

    // and all four can then complete, concurrently, with no more than four profiles
    const winners = results.filter((r) => r.flowCookie);
    const people = await Promise.all(winners.map((_, i) => createPerson({ label: `seat${i}` })));
    const outcomes = await Promise.all(winners.map((w, i) => callback(people[i], w)));
    expect(outcomes.map((o) => o.outcome)).toEqual(["joined", "joined", "joined", "joined"]);
    expect(await counts(inv.id)).toMatchObject({ reserved: 4, redeemed: 4, max: 4, rowsRedeemed: 4 });
  });

  it("ten people replaying the SAME grant at once produce exactly one learner; the other nine are refused and removed", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const people = await Promise.all(Array.from({ length: 10 }, (_, i) => createPerson({ label: `racer${i}` })));
    const outcomes = await Promise.all(people.map((p) => callback(p, s)));
    expect(outcomes.filter((o) => o.outcome === "joined").length).toBe(1);
    expect(outcomes.filter((o) => o.outcome === "invite_unusable").length).toBe(9);
    const survivors = (await Promise.all(people.map((p) => profileOf(p.id)))).filter(Boolean);
    expect(survivors.length).toBe(1);
    expect(await counts(inv.id)).toMatchObject({ redeemed: 1, rowsRedeemed: 1 });
    const gone = (await Promise.all(people.map((p) => authUserExists(p.id)))).filter((x) => !x).length;
    expect(gone).toBe(9);
  });

  it("a REPLAYED grant (a second person, later) is refused; the first learner is unaffected", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const first = await createPerson({ label: "first" });
    expect((await callback(first, s)).outcome).toBe("joined");
    const thief = await createPerson({ label: "thief" });
    expect(await callback(thief, s)).toMatchObject({ outcome: "invite_unusable" });
    expect(await authUserExists(thief.id)).toBe(false);
    expect((await viewerOf(first)).kind).toBe("learner");
    expect(await counts(inv.id)).toMatchObject({ redeemed: 1 });
  });

  it("the same person completing the callback twice (a double click) is not harmed", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const p = await createPerson({ label: "dbl" });
    const [a, b] = await Promise.all([callback(p, s), callback(p, s)]);
    expect([a.outcome, b.outcome].every((o) => o === "joined" || o === "signed_in")).toBe(true);
    expect((await viewerOf(p)).kind).toBe("learner");
    expect(await counts(inv.id)).toMatchObject({ redeemed: 1 });
  });

  it("a FORGED grant cookie (signed with a different secret) is refused before any database work", async () => {
    const inv = await makeInvitation(admin);
    const real = await startJoin(inv.code);
    const nonce = newNonce();
    const forged = signFlow({ v: 1, intent: "join", nonce, grant: "00000000-0000-4000-8000-000000000000", adultAt: new Date().toISOString(), exp: Math.floor(Date.now() / 1000) + 600 }, Buffer.from("not-the-real-secret-not-the-real-secret"));
    const p = await createPerson({ label: "forger" });
    expect(await callback(p, { flowCookie: forged, nonce })).toMatchObject({ outcome: "state" });
    expect(await profileOf(p.id)).toBeUndefined();
    expect(await counts(inv.id)).toMatchObject({ reserved: 1, redeemed: 0 }); // the real reservation is untouched
    expect(real.flowCookie).toBeTruthy();
  });

  it("a cookie from one browser with the nonce from another flow is refused (callback link replayed elsewhere)", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const p = await createPerson({ label: "mismatch" });
    expect(await callback(p, { flowCookie: s.flowCookie, nonce: newNonce() })).toMatchObject({ outcome: "state" });
    expect(await callback(p, { flowCookie: null, nonce: s.nonce })).toMatchObject({ outcome: "state" });
  });

  it("cancelling at Google gives the seat back at once, so a one-seat invitation can be retried immediately", async () => {
    const inv = await makeInvitation(admin, { maxUses: 1 });
    const s = await startJoin(inv.code);
    const { rt } = runtimeFor([{ name: config.cookieNames.flow, value: s.flowCookie as string }]);
    const { handleCallback } = await import("@/lib/auth/callback");
    expect((await handleCallback(rt, { code: null, providerError: "access_denied", flowParam: s.nonce })).outcome).toBe("cancelled");
    expect(await counts(inv.id)).toMatchObject({ reserved: 0 });
    expect((await startJoin(inv.code)).flowCookie).toBeTruthy();
  });
});

describe("unknown Google accounts", () => {
  it("get no private data and no account functionality while they hold a session", async () => {
    const stranger = await createPerson({ label: "stranger" });
    expect((await viewerOf(stranger)).kind).toBe("no_profile");
    const { client } = sessionFor(stranger.cookies);
    for (const table of ["profiles", "consents", "learner_documents", "learner_document_versions", "invitations", "invitation_reservations", "app_admins", "audit_events", "deletion_ledger", "rate_limits"]) {
      const r = await client.from(table).select("*");
      expect(r.data ?? [], table).toEqual([]); // zero rows, or a permission error: never data
    }
    const write = await client.rpc("put_document", { p_user: stranger.id, p_key: "lessons_v2", p_expected: 0, p_schema: 2, p_body: {} });
    expect(write.error).not.toBeNull();
    expect((await client.rpc("reserve_invitation", { p_code_hash: "\\x" + "00".repeat(32) })).error).not.toBeNull();
    const admin = await adminDeps(stranger);
    expect((await listInvitations(admin)).status).toBe(403);
    expect((await createInvitation(admin, { label: "x", maxUses: 1 })).status).toBe(403);
  });

  it("a plain sign-in by an uninvited Google account ends signed out, with the identity deleted and no profile ever created", async () => {
    const stranger = await createPerson({ label: "uninvited" });
    const s = await startSignIn();
    const r = await callback(stranger, s);
    expect(r).toMatchObject({ outcome: "no_account", redirect: "/auth/no-account" });
    expect(await profileOf(stranger.id)).toBeUndefined();
    expect(await authUserExists(stranger.id)).toBe(false);
    expect(r.jar.outgoing.get(config.cookieNames.auth)?.options.maxAge).toBe(0); // the session cookie is cleared
  });

  it("when the identity deletion FAILS the person is still refused, signed out, and has no access; the nightly sweep then removes them", async () => {
    const stranger = await createPerson({ label: "stuck" });
    const s = await startSignIn();
    const r = await callback(stranger, s, { db: { purgeOrphan: async () => { throw new Error("database unavailable"); } } });
    expect(r.outcome).toBe("no_account");
    expect(r.jar.outgoing.get(config.cookieNames.auth)?.options.maxAge).toBe(0);
    expect(await authUserExists(stranger.id)).toBe(true); // the cleanup really did fail
    expect(await profileOf(stranger.id)).toBeUndefined();
    // Even if the old session cookie were replayed (the session was revoked by sign-out; and even if it were not) there is no access:
    expect((await viewerOf(stranger)).kind).not.toBe("learner");
    expect((await sessionFor(stranger.cookies).client.from("profiles").select("*")).data ?? []).toEqual([]);

    // The sweep leaves a fresh identity alone (they may be mid sign-in) and removes one older than 25 hours (longer than a seat's hold).
    const before = await runCleanup(service);
    expect(before.failed).toEqual([]);
    expect(await authUserExists(stranger.id)).toBe(true);
    await q("update auth.users set created_at = now() - interval '26 hours' where id = $1", [stranger.id]);
    const after = await runCleanup(service);
    expect(after.failed).toEqual([]);
    expect(await authUserExists(stranger.id)).toBe(false);
  });
});

describe("returning learners", () => {
  it("sign in again and again with no invitation, and nothing about their seat changes", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const ana = await createPerson({ label: "returning" });
    expect((await callback(ana, s)).outcome).toBe("joined");
    const before = await counts(inv.id);
    for (let i = 0; i < 3; i++) {
      const again = await callback({ ...ana, cookies: await signIn(ana.email) }, await startSignIn());
      expect(again).toMatchObject({ outcome: "signed_in", redirect: "/account" });
    }
    expect(await counts(inv.id)).toEqual(before);
    expect(await authUserExists(ana.id)).toBe(true);
  });

  it("a returning learner who goes through the JOIN page by mistake is signed in and the unused seat is returned", async () => {
    const inv = await makeInvitation(admin, { maxUses: 2 });
    const member = await createPerson({ label: "member", learner: true });
    const s = await startJoin(inv.code);
    expect(await counts(inv.id)).toMatchObject({ reserved: 1 });
    expect((await callback(member, s)).outcome).toBe("signed_in");
    expect(await counts(inv.id)).toMatchObject({ reserved: 0, redeemed: 0 });
  });

  it("a SUSPENDED learner is refused, and is not deleted by the cleanup", async () => {
    const sus = await createPerson({ label: "suspended", learner: true });
    await q("update public.profiles set status = 'suspended' where id = $1", [sus.id]);
    expect((await viewerOf(sus)).kind).toBe("no_profile"); // RLS hides a suspended profile; indistinguishable from "no account"
    expect((await callback(sus, await startSignIn())).outcome).toBe("suspended");
    expect(await authUserExists(sus.id)).toBe(true);
    expect(await profileOf(sus.id)).toBeDefined();
  });
});

describe("no automatic account linking by email", () => {
  it("a Google identity attached to an account that also has another sign-in method is refused, and the existing learner is untouched", async () => {
    const victim = await createPerson({ label: "victim", learner: true, google: false });
    // The dangerous case: the Auth server (mis-configured) linked a google identity onto this existing, same-email account.
    const linked = await createPerson({ label: "linked", learner: true, providers: ["google", "email"] });
    const r = await callback(linked, await startSignIn());
    expect(r.outcome).toBe("identity");
    expect(await authUserExists(linked.id)).toBe(true); // it has a profile, so cleanup refuses to delete it
    expect(await profileOf(linked.id)).toBeDefined();
    expect(await profileOf(victim.id)).toBeDefined();
  });

  it("GoTrue itself will not create a second user with an existing learner's email, and the callback never looks anyone up by email", async () => {
    const first = await createPerson({ label: "dup", learner: true });
    const second = await service.auth.admin.createUser({ email: first.email, password: "Another-test-password-1!", email_confirm: true });
    expect(second.error).not.toBeNull();
    expect((await viewerOf(first)).kind).toBe("learner");
    const profileColumns = (await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'")).rows.map((r) => r.column_name);
    expect(profileColumns).not.toContain("email"); // nothing in the app's tables can be matched by email
  });

  it("an UNVERIFIED Google email never creates a learner, even with a valid invitation, and the seat comes back", async () => {
    const inv = await makeInvitation(admin);
    const s = await startJoin(inv.code);
    const p = await createPerson({ label: "unverified" });
    await q("update auth.identities set identity_data = identity_data || '{\"email_verified\": false}'::jsonb where user_id = $1", [p.id]);
    expect(await callback(p, s)).toMatchObject({ outcome: "unverified" });
    expect(await profileOf(p.id)).toBeUndefined();
    expect(await counts(inv.id)).toMatchObject({ reserved: 0, redeemed: 0 });
  });
});

describe("sessions", () => {
  it("a session the Auth server has revoked no longer opens anything, even though the cookie is still in the browser", async () => {
    const p = await createPerson({ label: "revoked-session", learner: true });
    expect((await viewerOf(p)).kind).toBe("learner");
    const token = JSON.parse(Buffer.from(decodeURIComponent(p.cookies.map((c) => c.value).join("")).replace(/^base64-/, ""), "base64url").toString("utf8")).access_token as string;
    const out = await service.auth.admin.signOut(token, "global");
    expect(out.error).toBeNull();
    expect((await viewerOf(p)).kind).toBe("anonymous");
  });

  it("a garbled, truncated or foreign session cookie is anonymous, never an error and never access", async () => {
    const p = await createPerson({ label: "garble", learner: true });
    const name = p.cookies[0].name;
    for (const value of ["", "garbage", "base64-AAAA", p.cookies[0].value.slice(0, 30), corruptMiddle(p.cookies[0].value)]) {
      expect((await viewerOf({ ...p, cookies: [{ name, value }] })).kind, value.slice(0, 20)).toBe("anonymous");
    }
    expect((await viewerOf({ ...p, cookies: [] })).kind).toBe("anonymous");
  });

  it("a token whose payload was edited (to extend its life or change the user) fails signature verification", async () => {
    const victim = await createPerson({ label: "victim-tamper", learner: true });
    const attacker = await createPerson({ label: "attacker" }); // no profile
    const read = (p: Person) => JSON.parse(Buffer.from(decodeURIComponent(p.cookies.map((c) => c.value).join("")).replace(/^base64-/, ""), "base64url").toString("utf8"));
    const a = read(attacker);
    const v = read(victim);
    const [h, , sig] = a.access_token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(v.access_token.split(".")[1], "base64url").toString()), exp: Math.floor(Date.now() / 1000) + 99999 })).toString("base64url");
    const forged = { ...a, access_token: `${h}.${forgedPayload}.${sig}` };
    const value = "base64-" + Buffer.from(JSON.stringify(forged)).toString("base64url");
    const viewer = await viewerOf({ ...attacker, cookies: [{ name: attacker.cookies[0].name, value }] });
    expect(viewer.kind).not.toBe("learner");
  });
});

describe("cross-account isolation", () => {
  it("each learner sees only their own profile; neither can read the other's or the owner's", async () => {
    const a = await createPerson({ label: "iso-a", learner: true });
    const b = await createPerson({ label: "iso-b", learner: true });
    const ca = sessionFor(a.cookies).client;
    const cb = sessionFor(b.cookies).client;
    expect((await ca.from("profiles").select("id")).data?.map((r) => r.id)).toEqual([a.id]);
    expect((await cb.from("profiles").select("id")).data?.map((r) => r.id)).toEqual([b.id]);
    expect((await ca.from("profiles").select("id").eq("id", b.id)).data).toEqual([]);
    expect((await ca.from("profiles").select("id").eq("id", admin.id)).data).toEqual([]);
    expect((await ca.from("consents").select("user_id")).data?.every((r) => r.user_id === a.id)).toBe(true);
    // a learner cannot write another learner's profile or their own privileged fields
    expect((await ca.from("profiles").update({ display_name: "hacked" }).eq("id", b.id).select()).data ?? []).toEqual([]);
    expect((await ca.from("profiles").update({ status: "suspended" }).eq("id", a.id)).error).not.toBeNull();
    expect((await viewerOf(a))).toMatchObject({ id: a.id, isAdmin: false });
    expect((await viewerOf(b))).toMatchObject({ id: b.id, isAdmin: false });
  });

  it("learners cannot use the owner's invitation API; anonymous callers are 401, strangers 403", async () => {
    const learner = await createPerson({ label: "plain", learner: true });
    const stranger = await createPerson({ label: "stranger2" });
    const anon = { ...(await adminDeps(learner)), viewer: { kind: "anonymous" } as const };
    expect((await listInvitations(anon)).status).toBe(401);
    expect((await listInvitations(await adminDeps(stranger))).status).toBe(403);
    expect((await listInvitations(await adminDeps(learner))).status).toBe(403);
    expect((await createInvitation(await adminDeps(learner), { label: "x", maxUses: 1 })).status).toBe(403);
  });
});

describe("owner invitation API", () => {
  it("creates an invitation and shows the code ONCE; the list never contains a code or a hash", async () => {
    const out = await createInvitation(await adminDeps(admin), { label: "cohort one", maxUses: 5, expiresInDays: 30 });
    expect(out.status).toBe(201);
    const created = out.body as { id: string; code: string; hint: string };
    expect(created.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}$/);
    const list = await listInvitations(await adminDeps(admin));
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(created.code);
    expect(text).not.toContain(created.code.replaceAll("-", ""));
    expect(text).not.toMatch(/code_hash|codeHash/);
    expect((list.body as { invitations: { id: string; code_hint: string }[] }).invitations.find((i) => i.id === created.id)?.code_hint).toBe(created.hint);
  });

  it("rejects unreasonable requests (too many seats, a past or far-future expiry, extra fields, wrong types)", async () => {
    const d = await adminDeps(admin);
    for (const bad of [{ label: "", maxUses: 1 }, { label: "x", maxUses: 0 }, { label: "x", maxUses: 101 }, { label: "x", maxUses: 1, expiresInDays: 0 }, { label: "x", maxUses: 1, expiresInDays: 91 }, { label: "x", maxUses: 1.5 }, { label: "x", maxUses: 1, role: "admin" }, null, "x", { label: "y".repeat(61), maxUses: 1 }])
      expect((await createInvitation(d, bad)).status, JSON.stringify(bad)).toBe(400);
  });

  it("refuses a cross-site POST even from the owner", async () => {
    const d = await adminDeps(admin, new Headers({ origin: "https://evil.example" }));
    expect((await createInvitation(d, { label: "x", maxUses: 1 })).status).toBe(403);
  });

  it("is rate limited per owner", async () => {
    const owner = await createPerson({ label: "busy-owner", learner: true, admin: true });
    const d = await adminDeps(owner, new Headers({ origin: config.siteUrl.origin, "x-real-ip": "192.0.2.77" }));
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await listInvitations(d)).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});

describe("rate limiter (database)", () => {
  const key = () => Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)));

  it("50 simultaneous hits against a limit of 10 allow EXACTLY 10", async () => {
    const k = key();
    const results = await Promise.all(Array.from({ length: 50 }, () => db.limiter.hit(k, 10, 60)));
    expect(results.filter((r) => r.allowed).length).toBe(10);
    expect(results.filter((r) => !r.allowed).every((r) => r.retryAfter >= 1 && r.retryAfter <= 60)).toBe(true);
  });

  it("starts a fresh window once the old one has ended", async () => {
    const k = key();
    for (let i = 0; i < 3; i++) await db.limiter.hit(k, 2, 60);
    expect((await db.limiter.hit(k, 2, 60)).allowed).toBe(false);
    await q("update public.rate_limits set window_start = now() - interval '61 seconds' where key = $1", [k]);
    expect((await db.limiter.hit(k, 2, 60)).allowed).toBe(true);
  });

  it("buckets are independent, and stored keys are 32-byte hashes (no address is stored)", async () => {
    const [a, b] = [key(), key()];
    for (let i = 0; i < 5; i++) await db.limiter.hit(a, 1, 60);
    expect((await db.limiter.hit(b, 1, 60)).allowed).toBe(true);
    expect((await q("select count(*)::int as n from public.rate_limits where octet_length(key) <> 32")).rows[0].n).toBe(0);
  });

  it("the join endpoint throttles one address and leaves another alone", async () => {
    const inv = await makeInvitation(admin, { maxUses: 100 });
    const mine = () => new Headers({ origin: config.siteUrl.origin, "x-real-ip": "203.0.113.200" });
    const results: (string | null)[] = [];
    for (let i = 0; i < 10; i++) results.push((await startJoin(inv.code, { headers: mine() })).location);
    expect(results.slice(0, 8).every((l) => l?.startsWith("http"))).toBe(true);
    expect(results.slice(8)).toEqual(["/join?e=rate", "/join?e=rate"]);
    expect((await startJoin(inv.code, { headers: freshHeaders() })).location).toMatch(/^http/);
    // brute-forcing codes from one address is cut off quickly
    const guesser = () => new Headers({ origin: config.siteUrl.origin, "x-real-ip": "203.0.113.201" });
    const guesses = [];
    for (let i = 0; i < 12; i++) guesses.push((await startJoin("ABCDEFGHJK" + "MNPQRSTUVWXYZ"[i], { headers: guesser() })).location);
    expect(guesses.filter((l) => l === "/join?e=rate").length).toBe(4);
  });
});

describe("reservations and cleanup functions", () => {
  it("release_expired_reservations returns abandoned seats once, leaves live holds, redemptions and revocations alone, and is idempotent", async () => {
    const inv = await makeInvitation(admin, { maxUses: 5 });
    const a = await startJoin(inv.code);
    const b = await startJoin(inv.code);
    const c = await startJoin(inv.code);
    expect([a, b, c].every((x) => x.flowCookie)).toBe(true);
    const grants = (await q("select grant_id from public.invitation_reservations where invitation_id = $1 order by created_at", [inv.id])).rows.map((r) => r.grant_id);
    await q("update public.invitation_reservations set expires_at = now() - interval '1 minute' where grant_id = $1", [grants[0]]);
    const person = await createPerson({ label: "redeemer" });
    expect((await callback(person, c)).outcome).toBe("joined"); // c redeems normally
    const one = (await q("select public.release_expired_reservations() as n")).rows[0].n;
    expect(one).toBeGreaterThanOrEqual(1);
    expect(await counts(inv.id)).toMatchObject({ reserved: 2, rowsReserved: 1, redeemed: 1, rowsRedeemed: 1 }); // b still held, c redeemed, a released
    const again = (await q("select public.release_expired_reservations() as n")).rows[0].n;
    expect(again).toBe(0);
  });

  it("purge_orphan_identity never deletes a learner or an admin, only a profile-less user, and audits a count only", async () => {
    const learner = await createPerson({ label: "keep-l", learner: true });
    const owner = await createPerson({ label: "keep-a", learner: true, admin: true });
    const adminNoProfile = await createPerson({ label: "keep-a2" });
    await q("insert into public.app_admins (user_id) values ($1)", [adminNoProfile.id]);
    const orphan = await createPerson({ label: "drop" });
    expect(await db.purgeOrphan(learner.id)).toBe(false);
    expect(await db.purgeOrphan(owner.id)).toBe(false);
    expect(await db.purgeOrphan(adminNoProfile.id)).toBe(false);
    expect(await db.purgeOrphan(orphan.id)).toBe(true);
    expect(await db.purgeOrphan(orphan.id)).toBe(false); // already gone
    for (const p of [learner, owner, adminNoProfile]) expect(await authUserExists(p.id)).toBe(true);
    const audits = (await q("select meta from public.audit_events where kind = 'identity_cleaned' order by id desc limit 5")).rows;
    expect(JSON.stringify(audits)).not.toContain(orphan.id);
    expect(JSON.stringify(audits)).not.toContain(orphan.email);
  });

  it("the sweep skips admins and learners and refuses a nonsensical age", async () => {
    const owner = await createPerson({ label: "old-admin" });
    await q("insert into public.app_admins (user_id) values ($1)", [owner.id]);
    const learner = await createPerson({ label: "old-learner", learner: true });
    await q("update auth.users set created_at = now() - interval '3 days' where id = any($1)", [[owner.id, learner.id]]);
    await runCleanup(service);
    expect(await authUserExists(owner.id)).toBe(true);
    expect(await authUserExists(learner.id)).toBe(true);
    await expect(q("select public.purge_orphan_identities(interval '1 second')")).rejects.toThrow();
  });
});
