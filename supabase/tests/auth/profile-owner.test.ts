import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvitation, expireInvitation, listInvitations, revokeInvitation } from "@/lib/auth/admin";
import { handleProfileGet, handleProfilePatch, readProfile, type ProfileDeps } from "@/lib/auth/profile-api";
import { getViewer } from "@/lib/auth/viewer";
import { listTopics } from "@/curriculum";
import { closePool, q } from "../helpers";
import { adminDeps, callback, config, counts, createPerson, db, freshHeaders, makeInvitation, service, sessionFor, startJoin, viewerOf, type Person } from "./kit";

/**
 * Phase 4 on the REAL local stack: real Auth sessions, real row-level security and column privileges, real invitation functions.
 * The profile API is exercised with the learner's own session client, exactly as the routes do.
 */
const topics = listTopics();
const good = { displayName: "Edited Name", firstLanguage: "Spanish", practising: [topics[0]], dailyMinutes: 15 };

async function profileDeps(p: Person, over: Partial<ProfileDeps> = {}): Promise<ProfileDeps> {
  const { client } = sessionFor(p.cookies);
  return { config, viewer: await getViewer(client), client, limiter: db.limiter, headers: freshHeaders(), ...over };
}
const rowOf = async (id: string) => (await q("select * from public.profiles where id = $1", [id])).rows[0];

let admin: Person;
beforeAll(async () => {
  await q("truncate public.rate_limits");
  admin = await createPerson({ label: "owner4", learner: true, admin: true });
});
afterAll(closePool);

describe("editing your own profile", () => {
  it("a learner changes name, language, topics and daily time; it persists; protected columns never move", async () => {
    const a = await createPerson({ label: "edit-a", learner: true });
    const before = await rowOf(a.id);
    const r = await handleProfilePatch(await profileDeps(a), good);
    expect(r.status).toBe(200);
    const after = await rowOf(a.id);
    expect(after).toMatchObject({ display_name: "Edited Name", first_language: "Spanish", status: "active", id: a.id });
    expect(after.preferences).toEqual({ v: 1, practising: [topics[0]], dailyMinutes: 15 });
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at).getTime());
    expect(after.adult_confirmed_at).toEqual(before.adult_confirmed_at);
    expect(after.joined_via_invitation).toEqual(before.joined_via_invitation);
    expect(after.created_at).toEqual(before.created_at);
    const read = await handleProfileGet(await profileDeps(a));
    expect(read.body).toMatchObject({ displayName: "Edited Name", email: a.email, preferences: { practising: [topics[0]], dailyMinutes: 15 } });
  });

  it("a learner can clear their language and goals", async () => {
    const a = await createPerson({ label: "edit-clear", learner: true });
    await handleProfilePatch(await profileDeps(a), good);
    expect((await handleProfilePatch(await profileDeps(a), { ...good, firstLanguage: null, practising: [] })).status).toBe(200);
    expect(await rowOf(a.id)).toMatchObject({ first_language: null, preferences: { v: 1, practising: [], dailyMinutes: 15 } });
  });
});

describe("unauthorized profile edits", () => {
  it("one learner cannot change another's profile by any route the app or the data API offers", async () => {
    const a = await createPerson({ label: "attacker", learner: true });
    const b = await createPerson({ label: "victim", learner: true });
    const bBefore = await rowOf(b.id);

    // 1. through the app: the body cannot name a person at all
    for (const extra of [{ id: b.id }, { userId: b.id }, { user_id: b.id }]) {
      expect((await handleProfilePatch(await profileDeps(a), { ...good, ...extra })).status).toBe(400);
    }
    // 2. through the data API with the attacker's valid session: row-level security matches no row
    const { client } = sessionFor(a.cookies);
    const upd = await client.from("profiles").update({ display_name: "hacked" }).eq("id", b.id).select();
    expect(upd.data ?? []).toEqual([]);
    // 3. deleting or inserting rows is not possible either
    expect((await client.from("profiles").delete().eq("id", b.id).select()).data ?? []).toEqual([]);
    expect((await client.from("profiles").insert({ id: b.id, display_name: "x", adult_confirmed_at: new Date().toISOString() })).error).not.toBeNull();
    // 4. reading is closed too
    expect(await readProfile(client, b.id)).toBeNull();
    expect((await client.from("profiles").select("*").eq("id", b.id)).data).toEqual([]);

    expect(await rowOf(b.id)).toEqual(bBefore);
  });

  it("even if the app's identity check were bypassed (a forged viewer), row-level security still refuses: no privileged credential rescues it", async () => {
    const a = await createPerson({ label: "forger-a", learner: true });
    const b = await createPerson({ label: "forged-b", learner: true });
    const bBefore = await rowOf(b.id);
    const forged = await profileDeps(a, { viewer: { kind: "learner", id: b.id, displayName: "B", isAdmin: false } });
    const r = await handleProfilePatch(forged, { ...good, displayName: "hacked by forgery" });
    expect(r.status).toBe(403);
    expect(await rowOf(b.id)).toEqual(bBefore);
  });

  it("a learner cannot change their own status, age confirmation, id or invitation link, directly", async () => {
    const a = await createPerson({ label: "privileged", learner: true });
    const before = await rowOf(a.id);
    const { client } = sessionFor(a.cookies);
    for (const patch of [{ status: "suspended" }, { adult_confirmed_at: "2000-01-01T00:00:00Z" }, { id: "00000000-0000-4000-8000-000000000000" }, { joined_via_invitation: null }, { created_at: "2000-01-01T00:00:00Z" }]) {
      const r = await client.from("profiles").update(patch).eq("id", a.id).select();
      expect(r.error, JSON.stringify(patch)).not.toBeNull();
    }
    expect(await rowOf(a.id)).toEqual(before);
  });

  it("the database itself bounds preferences (an oversized document is refused even from the data API)", async () => {
    const a = await createPerson({ label: "bounded", learner: true });
    const { client } = sessionFor(a.cookies);
    expect((await client.from("profiles").update({ preferences: { x: "a".repeat(5000) } }).eq("id", a.id)).error).not.toBeNull();
    expect((await client.from("profiles").update({ display_name: "y".repeat(41) }).eq("id", a.id)).error).not.toBeNull();
  });

  it("an uninvited Google identity gets 403 and creates nothing; anonymous gets 401", async () => {
    const stranger = await createPerson({ label: "no-profile4" });
    expect((await handleProfilePatch(await profileDeps(stranger), good)).status).toBe(403);
    expect((await handleProfileGet(await profileDeps(stranger))).status).toBe(403);
    expect(await rowOf(stranger.id)).toBeUndefined();
    const anon = await profileDeps(stranger, { viewer: { kind: "anonymous" } });
    expect((await handleProfilePatch(anon, good)).status).toBe(401);
    expect((await handleProfileGet(anon)).status).toBe(401);
  });

  it("a suspended learner can neither read nor change their profile", async () => {
    const s = await createPerson({ label: "suspended4", learner: true });
    await q("update public.profiles set status = 'suspended' where id = $1", [s.id]);
    const before = await rowOf(s.id);
    expect((await handleProfilePatch(await profileDeps(s), good)).status).toBe(403);
    expect((await handleProfileGet(await profileDeps(s))).status).toBe(403);
    expect(await rowOf(s.id)).toEqual(before);
  });

  it("a revoked session cannot edit", async () => {
    const a = await createPerson({ label: "revoked4", learner: true });
    const token = JSON.parse(Buffer.from(decodeURIComponent(a.cookies.map((c) => c.value).join("")).replace(/^base64-/, ""), "base64url").toString("utf8")).access_token as string;
    await service.auth.admin.signOut(token, "global");
    expect((await handleProfilePatch(await profileDeps(a), good)).status).toBe(401);
  });
});

describe("cross-account dashboard data", () => {
  it("each learner's profile read returns only their own data", async () => {
    const [a, b] = await Promise.all([createPerson({ label: "dash-a", learner: true }), createPerson({ label: "dash-b", learner: true })]);
    await handleProfilePatch(await profileDeps(a), { ...good, displayName: "Alpha", practising: [topics[0]] });
    await handleProfilePatch(await profileDeps(b), { ...good, displayName: "Bravo", practising: [] });
    const ra = (await handleProfileGet(await profileDeps(a))).body as { displayName: string; email: string; preferences: { practising: string[] } };
    const rb = (await handleProfileGet(await profileDeps(b))).body as { displayName: string; email: string; preferences: { practising: string[] } };
    expect([ra.displayName, ra.email]).toEqual(["Alpha", a.email]);
    expect([rb.displayName, rb.email]).toEqual(["Bravo", b.email]);
    expect(ra.preferences.practising).toEqual([topics[0]]);
    expect(rb.preferences.practising).toEqual([]);
    expect(JSON.stringify(ra)).not.toContain("Bravo");
    expect(JSON.stringify(rb)).not.toContain("Alpha");
    expect(await viewerOf(a)).toMatchObject({ id: a.id, displayName: "Alpha" });
    expect(await viewerOf(b)).toMatchObject({ id: b.id, displayName: "Bravo" });
  });
});

describe("owner invitation management", () => {
  it("create → list → expire → revoke: audited with the owner as actor, and the plaintext code is nowhere in the database", async () => {
    const out = await createInvitation(await adminDeps(admin), { label: "audit run", maxUses: 3, expiresInDays: 7 });
    expect(out.status).toBe(201);
    const { id, code } = out.body as { id: string; code: string };
    const plain = code.replaceAll("-", "");

    expect((await expireInvitation(await adminDeps(admin), id)).status).toBe(200);
    expect((await expireInvitation(await adminDeps(admin), id)).status).toBe(200); // idempotent
    expect((await revokeInvitation(await adminDeps(admin), id)).status).toBe(200);

    const audit = (await q("select kind, actor, meta from public.audit_events where meta->>'invitation' = $1 order by id", [id])).rows;
    expect(audit.map((a) => a.kind)).toEqual(["invite_created", "invite_expired", "invite_revoked"]); // expire audited ONCE
    expect(audit.every((a) => a.actor === admin.id)).toBe(true);

    // search every text-bearing table for the code, in both spellings
    const hay = (await q(`select (select coalesce(string_agg(meta::text, ' '), '') from public.audit_events) as audit,
                                 (select coalesce(string_agg(i::text, ' '), '') from public.invitations i) as inv,
                                 (select coalesce(string_agg(r::text, ' '), '') from public.invitation_reservations r) as res,
                                 (select coalesce(string_agg(p::text, ' '), '') from public.profiles p) as prof`)).rows[0];
    for (const text of Object.values(hay) as string[]) {
      expect(text).not.toContain(code);
      expect(text).not.toContain(plain);
    }
  });

  it("the list never contains a code or a hash, only the last four characters", async () => {
    const inv = await makeInvitation(admin, { label: "list check" });
    const list = JSON.stringify((await listInvitations(await adminDeps(admin))).body);
    expect(list).not.toContain(inv.code);
    expect(list).not.toContain(inv.code.replaceAll("-", ""));
    expect(list).not.toMatch(/code_hash|codeHash/);
    expect(list).toContain(inv.code.replaceAll("-", "").slice(-4));
  });

  it("expiring stops new sign-ins at once, but lets someone already mid sign-in finish; revoked invitations are left alone", async () => {
    const inv = await makeInvitation(admin, { maxUses: 2, label: "expire flow" });
    const midFlow = await startJoin(inv.code);
    expect(midFlow.flowCookie).toBeTruthy();
    expect((await expireInvitation(await adminDeps(admin), inv.id)).status).toBe(200);

    const late = await startJoin(inv.code);
    expect(late.location).toBe("/join?e=expired"); // nobody new can start
    const person = await createPerson({ label: "mid-flow" });
    expect((await callback(person, midFlow)).outcome).toBe("joined"); // the person already partway through can finish
    expect(await counts(inv.id)).toMatchObject({ redeemed: 1 });

    const dead = await makeInvitation(admin, { label: "already revoked" });
    await revokeInvitation(await adminDeps(admin), dead.id);
    await expireInvitation(await adminDeps(admin), dead.id);
    expect((await q("select count(*)::int as n from public.audit_events where kind = 'invite_expired' and meta->>'invitation' = $1", [dead.id])).rows[0].n).toBe(0);
    expect((await q("select revoked_at is not null as r from public.invitations where id = $1", [dead.id])).rows[0].r).toBe(true);
  });

  it("only the owner may do any of it: learners, strangers and anonymous callers are refused and nothing changes", async () => {
    const inv = await makeInvitation(admin, { label: "owner only" });
    const before = (await q("select * from public.invitations where id = $1", [inv.id])).rows[0];
    const learner = await createPerson({ label: "plain4", learner: true });
    const stranger = await createPerson({ label: "stranger4" });
    const anon = { ...(await adminDeps(learner)), viewer: { kind: "anonymous" } as const };
    for (const [who, expected] of [[await adminDeps(learner), 403], [await adminDeps(stranger), 403], [anon, 401]] as const) {
      expect((await expireInvitation(who, inv.id)).status).toBe(expected);
      expect((await revokeInvitation(who, inv.id)).status).toBe(expected);
      expect((await createInvitation(who, { label: "x", maxUses: 1 })).status).toBe(expected);
      expect((await listInvitations(who)).status).toBe(expected);
    }
    expect((await q("select * from public.invitations where id = $1", [inv.id])).rows[0]).toEqual(before);
  });

  it("a cross-site request cannot expire or revoke, even from the owner's browser", async () => {
    const inv = await makeInvitation(admin, { label: "csrf" });
    const d = await adminDeps(admin, new Headers({ origin: "https://evil.example", "x-real-ip": "198.51.100.250" }));
    expect((await expireInvitation(d, inv.id)).status).toBe(403);
    expect((await revokeInvitation(d, inv.id)).status).toBe(403);
    expect((await q("select revoked_at, expires_at > now() as live from public.invitations where id = $1", [inv.id])).rows[0]).toMatchObject({ revoked_at: null, live: true });
  });

  it("rejects a malformed id without touching the database", async () => {
    expect((await expireInvitation(await adminDeps(admin), "not-a-uuid")).status).toBe(400);
  });
});
