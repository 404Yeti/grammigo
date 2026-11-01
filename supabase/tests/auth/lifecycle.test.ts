import { afterAll, describe, expect, it } from "vitest";
import { handleSyncState } from "@/lib/auth/sync-api";
import { DELETE_CONFIRM_PHRASE } from "@/lib/auth/constants";
import { handleDelete, handleExport, ledgerHash, readSignedInAt, replayDeletionLedger, serviceReplayDb, type LifecycleDeps } from "@/lib/auth/lifecycle";
import { getViewer } from "@/lib/auth/viewer";
import { closePool, docBody, put, q } from "../helpers";
import { config, createPerson, db, freshHeaders, service, sessionFor, signIn, type Person } from "./kit";

/**
 * Export, deletion and restore on the REAL local stack: real Auth sessions (and so real `amr` sign-in times), real row-level security, the
 * real deletion function and ledger. Only Google's consent screen is absent.
 */
afterAll(closePool);

const ok = { confirm: DELETE_CONFIRM_PHRASE };
let ended = 0;
async function deps(p: Person, over: Partial<LifecycleDeps> = {}): Promise<LifecycleDeps> {
  const { client } = sessionFor(p.cookies);
  const viewer = await getViewer(client);
  return { config, viewer, client, service, limiter: db.limiter, headers: freshHeaders(), signedInAt: viewer.kind === "learner" ? await readSignedInAt(client) : null, now: () => Date.now(), log: () => undefined, endSession: () => void ended++, ...over };
}
const count = async (sql: string, id: string) => (await q(sql, [id])).rows[0].n as number;
const OWNED = ["select count(*)::int n from public.profiles where id = $1", "select count(*)::int n from public.consents where user_id = $1", "select count(*)::int n from public.learner_documents where user_id = $1", "select count(*)::int n from public.learner_document_versions where user_id = $1", "select count(*)::int n from public.app_admins where user_id = $1"];
const AUTH = ["select count(*)::int n from auth.users where id = $1", "select count(*)::int n from auth.identities where user_id = $1", "select count(*)::int n from auth.sessions where user_id = $1", "select count(*)::int n from auth.refresh_tokens where user_id::text = $1::text"];

async function withData(label: string, marker: string) {
  const p = await createPerson({ label, learner: true });
  await put(p.id, "lessons_v2", 0, docBody("lessons_v2", { marker }));
  await put(p.id, "guided_v1", 0, docBody("guided_v1", { marker }));
  await put(p.id, "guided_v1", 1, docBody("guided_v1", { marker, n: 2 })); // a second revision
  return p;
}

describe("export (real row-level security)", () => {
  it("returns the signed-in learner's records and not one byte of another learner's", async () => {
    const a = await withData("exp-a", "MARKER-A-1f7c");
    const b = await withData("exp-b", "MARKER-B-9d2e");
    const out = await handleExport(await deps(a));
    expect(out.status).toBe(200);
    const text = JSON.stringify(out.body);
    expect(text).toContain("MARKER-A-1f7c");
    expect(text).not.toContain("MARKER-B-9d2e");
    expect(text).not.toContain(b.id);
    expect(text).not.toContain(b.email);
    expect(out.body).toMatchObject({ account: { id: a.id, email: a.email }, profile: { displayName: "Test exp-a" } });
    const body = out.body as { progress: { document: string; revision: number }[]; consents: { kind: string }[] };
    expect(body.progress.map((d) => `${d.document}@${d.revision}`).sort()).toEqual(["guided_v1@2", "lessons_v2@1"]);
    expect(body.consents.map((c) => c.kind).sort()).toEqual(["adult_confirmation", "cloud_storage"]);
    // and B's export likewise contains none of A's
    const other = JSON.stringify((await handleExport(await deps(b))).body);
    expect(other).toContain("MARKER-B-9d2e");
    expect(other).not.toContain("MARKER-A-1f7c");
  });

  it("is audited as a fact only: who asked and when, never the content", async () => {
    const a = await withData("exp-audit", "MARKER-AUDIT-77aa");
    await handleExport(await deps(a));
    const rows = (await q("select kind, meta from public.audit_events where actor = $1", [a.id])).rows;
    expect(rows).toEqual([{ kind: "export_requested", meta: {} }]);
  });

  it("is refused for a visitor with no session, an uninvited Google identity, and a foreign origin", async () => {
    const anon = await deps({ id: "", email: "", cookies: [] });
    expect((await handleExport(anon)).status).toBe(401);
    const stranger = await createPerson({ label: "exp-stranger" }); // Google identity, no profile
    expect((await handleExport(await deps(stranger))).status).toBe(403);
    const a = await withData("exp-origin", "x");
    expect((await handleExport(await deps(a, { headers: new Headers({ origin: "https://evil.example" }) }))).status).toBe(403);
  });

  it("is rate limited: the sixth request in an hour is refused", async () => {
    const a = await withData("exp-rate", "x");
    const headers = freshHeaders();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await handleExport(await deps(a, { headers }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("recent sign-in, from the real session", () => {
  it("a session that has just signed in reports a sign-in time within the last minute", async () => {
    const a = await createPerson({ label: "recent", learner: true });
    const t = await readSignedInAt(sessionFor(a.cookies).client);
    expect(t).not.toBeNull();
    expect(Date.now() / 1000 - (t as number)).toBeLessThan(60);
    expect(Date.now() / 1000 - (t as number)).toBeGreaterThanOrEqual(-5);
  });
  it("no session means unknown", async () => {
    expect(await readSignedInAt(sessionFor([]).client)).toBeNull();
  });
});

describe("account deletion", () => {
  it("refuses wrong words and a stale sign-in, and deletes NOTHING", async () => {
    const a = await withData("del-refused", "x");
    expect((await handleDelete(await deps(a), { confirm: "delete" })).status).toBe(400);
    expect(await handleDelete(await deps(a, { signedInAt: Math.floor(Date.now() / 1000) - 3_600 }), ok)).toMatchObject({ status: 403, body: { error: "reauth_required" } });
    expect(await count("select count(*)::int n from auth.users where id = $1", a.id)).toBe(1);
    expect(await count("select count(*)::int n from public.learner_documents where user_id = $1", a.id)).toBe(2);
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [ledgerHash(a.id, config.pepper)])).rows[0].n).toBe(0); // and no ledger entry for a deletion that did not happen
  });

  it("deletes every row, session and identity of the learner, writes the ledger entry, and leaves a bystander and the counts intact", async () => {
    const bystander = await withData("del-bystander", "MARKER-BYSTANDER");
    const a = await withData("del-a", "MARKER-A");
    const before = ended;
    const out = await handleDelete(await deps(a), ok);
    expect(out).toMatchObject({ status: 200, body: { deleted: true } });
    expect(ended).toBe(before + 1);
    for (const sql of [...OWNED, ...AUTH]) expect(await count(sql, a.id), sql).toBe(0); // no orphan anywhere
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [ledgerHash(a.id, config.pepper)])).rows[0].n).toBe(1);
    expect((await q("select count(*)::int n from public.audit_events where actor = $1", [a.id])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.audit_events where kind = 'account_deleted' and meta = '{}'::jsonb")).rows[0].n).toBeGreaterThanOrEqual(1);
    // the bystander is untouched, in every table
    expect(await count(OWNED[0], bystander.id)).toBe(1);
    expect(await count(OWNED[2], bystander.id)).toBe(2);
    expect(await count(AUTH[0], bystander.id)).toBe(1);
  });

  it("invalidates the session everywhere: the old cookies are signed out, the API refuses them, and the refresh token no longer works", async () => {
    const a = await withData("del-session", "x");
    const device2 = await signIn(a.email); // a second device of the same person
    const { client: c1 } = sessionFor(a.cookies);
    const refresh = (await c1.auth.getSession()).data.session?.refresh_token as string;
    expect(refresh).toBeTruthy();
    expect((await handleDelete(await deps(a), ok)).status).toBe(200);
    for (const cookies of [a.cookies, device2]) {
      expect((await getViewer(sessionFor(cookies).client)).kind).toBe("anonymous");
      const state = await handleSyncState({ config, viewer: await getViewer(sessionFor(cookies).client), client: sessionFor(cookies).client, service, limiter: db.limiter, headers: freshHeaders() });
      expect(state.status).toBe(401);
    }
    const refreshed = await sessionFor([]).client.auth.refreshSession({ refresh_token: refresh });
    expect(refreshed.data.session).toBeNull();
    expect(refreshed.error).not.toBeNull();
  });

  it("deleting twice at once is harmless: both finish, one ledger row, nothing left", async () => {
    const a = await withData("del-twice", "x");
    const [d1, d2] = [await deps(a), await deps(a)];
    const results = await Promise.all([handleDelete(d1, ok), handleDelete(d2, ok)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [ledgerHash(a.id, config.pepper)])).rows[0].n).toBe(1);
    expect(await count(AUTH[0], a.id)).toBe(0);
  });

  it("will not delete the owner: refused by the handler, and by the database function itself", async () => {
    const owner = await createPerson({ label: "del-owner", admin: true });
    expect(await handleDelete(await deps(owner), ok)).toMatchObject({ status: 409 });
    await expect(q("select public.delete_learner($1, $2)", [owner.id, ledgerHash(owner.id, config.pepper)])).rejects.toThrow(/owner accounts/);
    expect(await count(AUTH[0], owner.id)).toBe(1);
    expect((await q("select public.redelete_learner($1) r", [owner.id])).rows[0].r).toBe(false);
  });

  it("a wrong-words storm is rate limited: the sixth attempt in ten minutes is refused, even with the right words", async () => {
    const a = await withData("del-rate", "x");
    const headers = freshHeaders();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await handleDelete(await deps(a, { headers }), { confirm: "no" })).status);
    statuses.push((await handleDelete(await deps(a, { headers }), ok)).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    expect(await count(AUTH[0], a.id)).toBe(1);
  });

  it("a visitor with no session, and an uninvited Google identity, can delete nothing", async () => {
    expect((await handleDelete(await deps({ id: "", email: "", cookies: [] }), ok)).status).toBe(401);
    const stranger = await createPerson({ label: "del-stranger" });
    expect((await handleDelete(await deps(stranger), ok)).status).toBe(403);
    expect(await count(AUTH[0], stranger.id)).toBe(1);
  });

  it("cross-account: a learner's request can only ever delete themselves, whatever else is in the body", async () => {
    const a = await withData("del-cross-a", "x");
    const b = await withData("del-cross-b", "x");
    expect((await handleDelete(await deps(a), { ...ok, userId: b.id })).status).toBe(400); // the body may not name anyone
    expect(await count(AUTH[0], b.id)).toBe(1);
    expect((await handleDelete(await deps(a), ok)).status).toBe(200);
    expect(await count(AUTH[0], b.id)).toBe(1);
    expect(await count(OWNED[2], b.id)).toBe(2);
  });
});

/** The pieces of a person that a backup would hold, and putting them back the way a restore does. */
async function snapshot(id: string) {
  const one = async (sql: string) => (await q(sql, [id])).rows.map((r) => r.j as Record<string, unknown>);
  return {
    user: await one("select jsonb_build_object('id', id, 'aud', aud, 'role', role, 'email', email, 'created_at', created_at, 'updated_at', updated_at, 'email_confirmed_at', email_confirmed_at, 'raw_app_meta_data', raw_app_meta_data, 'raw_user_meta_data', raw_user_meta_data) j from auth.users where id = $1"),
    profile: await one("select to_jsonb(t) j from public.profiles t where id = $1"),
    consents: await one("select to_jsonb(t) j from public.consents t where user_id = $1"),
    docs: await one("select to_jsonb(t) j from public.learner_documents t where user_id = $1"),
  };
}
async function restore(s: Awaited<ReturnType<typeof snapshot>>) {
  for (const j of s.user) await q("insert into auth.users (id, aud, role, email, created_at, updated_at, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) select (j->>'id')::uuid, j->>'aud', j->>'role', j->>'email', (j->>'created_at')::timestamptz, (j->>'updated_at')::timestamptz, (j->>'email_confirmed_at')::timestamptz, j->'raw_app_meta_data', j->'raw_user_meta_data' from (select $1::jsonb j) x", [JSON.stringify(j)]);
  for (const j of s.profile) await q("insert into public.profiles select * from jsonb_populate_record(null::public.profiles, $1::jsonb)", [JSON.stringify(j)]);
  for (const j of s.consents) await q("insert into public.consents select * from jsonb_populate_record(null::public.consents, $1::jsonb)", [JSON.stringify(j)]);
  for (const j of s.docs) await q("insert into public.learner_documents select * from jsonb_populate_record(null::public.learner_documents, $1::jsonb)", [JSON.stringify(j)]);
}

describe("backup restore and deletion-ledger replay (logical simulation on a disposable local database)", () => {
  it("a person deleted AFTER the backup is back after the restore, and is deleted again by the replay, while everyone else is kept", async () => {
    const keeper = await withData("restore-keeper", "KEEP");
    const leaver = await withData("restore-leaver", "LEAVE");
    const owner = await createPerson({ label: "restore-owner", admin: true });
    const backup = { keeper: await snapshot(keeper.id), leaver: await snapshot(leaver.id) }; // "the backup", taken while both existed

    expect((await handleDelete(await deps(leaver), ok)).status).toBe(200); // the leaver deletes their account after the backup
    expect(await count(AUTH[0], leaver.id)).toBe(0);

    // DISASTER: the database is restored from the backup. The ledger entry written AFTER the backup would be lost with it, so the runbook
    // exports the ledger before restoring and puts it back; here the live ledger row is simply still there, as after that step.
    await q("delete from auth.users where id = $1", [keeper.id]);
    await restore(backup.keeper);
    await restore(backup.leaver);
    expect(await count(AUTH[0], leaver.id)).toBe(1); // the person who asked to be deleted is back
    expect(await count(OWNED[2], leaver.id)).toBe(2);

    const replay = serviceReplayDb(service);
    const first = await replayDeletionLedger(replay, config.pepper);
    expect(first.deleted).toBeGreaterThanOrEqual(1);
    for (const sql of [...OWNED, ...AUTH]) expect(await count(sql, leaver.id), sql).toBe(0);
    expect(await count(AUTH[0], keeper.id)).toBe(1); // the keeper stays, with their data
    expect(await count(OWNED[2], keeper.id)).toBe(2);
    expect(await count(AUTH[0], owner.id)).toBe(1);

    const second = await replayDeletionLedger(replay, config.pepper); // idempotent
    expect(second.deleted).toBe(0);
  });

  it("with the wrong key the replay deletes nobody, and says so (a ledger that matched no one)", async () => {
    const leaver = await withData("restore-wrongkey", "x");
    const snap = await snapshot(leaver.id);
    await handleDelete(await deps(leaver), ok);
    await restore(snap);
    const out = await replayDeletionLedger(serviceReplayDb(service), Buffer.from("this-is-not-the-production-key-at-all"));
    expect(out.deleted).toBe(0);
    expect(out.ledger).toBeGreaterThan(0);
    expect(await count(AUTH[0], leaver.id)).toBe(1);
    await replayDeletionLedger(serviceReplayDb(service), config.pepper); // clean up with the right key
    expect(await count(AUTH[0], leaver.id)).toBe(0);
  });

  it("the replay functions are server-only", async () => {
    const a = await createPerson({ label: "replay-denied", learner: true });
    const { client } = sessionFor(a.cookies);
    for (const [fn, args] of [["all_user_ids", {}], ["ledger_hashes", {}], ["redelete_learner", { p_user: a.id }], ["audit_export", { p_user: a.id }], ["delete_learner", { p_user: a.id, p_user_hash: "\\x00" }]] as const) {
      const r = await client.rpc(fn, args);
      expect(r.error, fn).not.toBeNull();
    }
    expect(await count(AUTH[0], a.id)).toBe(1);
  });
});
