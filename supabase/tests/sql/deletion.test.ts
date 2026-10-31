import { afterAll, describe, expect, it } from "vitest";
import { DENIED, attempt, closePool, createAdmin, createAuthUser, createInvitation, createLearner, docBody, hash, iso, put, q, redeem, reserve } from "../helpers";

afterAll(closePool);

/** Every table that references auth.users, and the column that does. Kept in step with the catalogue test. */
const OWNED: [table: string, column: string][] = [
  ["profiles", "id"], ["consents", "user_id"], ["learner_documents", "user_id"], ["learner_document_versions", "user_id"], ["app_admins", "user_id"],
];

async function rich(): Promise<{ user: string; invitation: string; hash: Buffer }> {
  const inv = await createInvitation({ max: 3 });
  const user = await createAuthUser("rich");
  await redeem((await reserve(inv.codeHash)).grant_id as string, user);          // profile, consents, reservation, audit rows
  await put(user, "lessons_v2", 0, docBody("lessons_v2"));
  await put(user, "guided_v1", 0, docBody("guided_v1"));
  await put(user, "guided_v1", 1, docBody("guided_v1", { n: 2 }));               // two versions
  await q("insert into public.audit_events (actor, kind) values ($1, 'sync_conflict')", [user]);
  return { user, invitation: inv.id, hash: hash() };
}

describe("account deletion", () => {
  it("removes every row that belongs to the learner, in every table, and writes the ledger entry in the same step", async () => {
    const other = await createLearner("bystander");
    await put(other, "guided_v1", 0, docBody("guided_v1"));
    const r = await rich();
    await q("select public.delete_learner($1, $2)", [r.user, r.hash]);
    for (const [t, c] of OWNED) expect((await q(`select count(*)::int n from public.${t} where ${c} = $1`, [r.user])).rows[0].n, `${t}.${c}`).toBe(0);
    expect((await q("select count(*)::int n from auth.users where id = $1", [r.user])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [r.hash])).rows[0].n).toBe(1);
    // reservations and audit rows survive WITHOUT any link to the person
    expect((await q("select count(*)::int n, count(user_id)::int linked from public.invitation_reservations where invitation_id = $1", [r.invitation])).rows[0]).toEqual({ n: 1, linked: 0 });
    expect((await q("select count(*)::int linked from public.audit_events where actor = $1", [r.user])).rows[0].linked).toBe(0);
    expect((await q("select count(*)::int n from public.audit_events where kind = 'account_deleted'")).rows[0].n).toBeGreaterThanOrEqual(1);
    // the bystander is untouched
    expect((await q("select count(*)::int n from public.learner_documents where user_id = $1", [other])).rows[0].n).toBe(1);
    expect((await q("select count(*)::int n from public.profiles where id = $1", [other])).rows[0].n).toBe(1);
  });

  it("is idempotent, and the invitation's counts still add up afterwards", async () => {
    const r = await rich();
    await q("select public.delete_learner($1, $2)", [r.user, r.hash]);
    await q("select public.delete_learner($1, $2)", [r.user, r.hash]);
    expect((await q("select reserved_count, redeemed_count from public.invitations where id = $1", [r.invitation])).rows[0]).toEqual({ reserved_count: 1, redeemed_count: 1 });
  });

  it("deleting the auth user directly (what the Auth admin API does) cascades the same way", async () => {
    const r = await rich();
    await q("delete from auth.users where id = $1", [r.user]);
    for (const [t, c] of OWNED) expect((await q(`select count(*)::int n from public.${t} where ${c} = $1`, [r.user])).rows[0].n, t).toBe(0);
  });
});

describe("the deletion ledger", () => {
  it("cannot be touched by any client role", async () => {
    const A = await createLearner("ledger");
    const admin = await createAdmin();
    const h = hash();
    await q("insert into public.deletion_ledger (user_hash) values ($1)", [h]);
    for (const [role, user] of [["authenticated", A], ["authenticated", admin], ["anon", null]] as const) {
      for (const sql of ["select * from public.deletion_ledger", "insert into public.deletion_ledger (user_hash) values ('\\x" + "00".repeat(32) + "')", "update public.deletion_ledger set deleted_at = now()", "delete from public.deletion_ledger", "truncate public.deletion_ledger"]) {
        expect((await attempt(role, user, sql)).code, `${role}: ${sql.slice(0, 30)}`).toBe(DENIED);
      }
      expect((await attempt(role, user, "select public.delete_learner(gen_random_uuid(), '\\x00'::bytea)")).code).toBe(DENIED);
    }
  });

  it("is immutable even for the server: no updates, no deletes inside 35 days, deletes allowed after", async () => {
    const h = hash();
    await q("insert into public.deletion_ledger (user_hash) values ($1)", [h]);
    await expect(q("update public.deletion_ledger set deleted_at = now() - interval '99 days' where user_hash = $1", [h])).rejects.toThrow(/immutable/);
    await expect(q("delete from public.deletion_ledger where user_hash = $1", [h])).rejects.toThrow(/kept for 35 days/);
    const old = hash();
    await q("insert into public.deletion_ledger (user_hash, deleted_at) values ($1, now() - interval '36 days')", [old]);
    await q("delete from public.deletion_ledger where user_hash = $1", [old]);
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [old])).rows[0].n).toBe(0);
  });

  it("holds only a 32-byte hash, nothing readable", async () => {
    await expect(q("insert into public.deletion_ledger (user_hash) values ('\\x01')")).rejects.toMatchObject({ code: "23514" });
  });
});

describe("audit events", () => {
  it("are append-only (the only allowed change is clearing the actor link on account deletion)", async () => {
    const id = (await q("insert into public.audit_events (kind) values ('sync_conflict') returning id")).rows[0].id;
    await expect(q("update public.audit_events set kind = 'account_deleted' where id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(q("update public.audit_events set meta = '{\"x\":1}' where id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(q("delete from public.audit_events where id = $1", [id])).rejects.toThrow(/kept for 90 days/);
  });
});

describe("intermediate identities", () => {
  it("lists profile-less accounts older than the cutoff, never learners, admins or recent sign-ins", async () => {
    const mk = async (ageHours: number) => {
      const id = await createAuthUser("idle");
      await q("update auth.users set created_at = now() - ($2 || ' hours')::interval where id = $1", [id, String(ageHours)]);
      return id;
    };
    const [stale, recent] = [await mk(3), await mk(0)];
    const learner = await createLearner("real"); await q("update auth.users set created_at = now() - interval '5 hours' where id = $1", [learner]);
    const admin = await createAdmin(); await q("update auth.users set created_at = now() - interval '5 hours' where id = $1", [admin]);
    const listed = (await q("select user_id from public.orphan_identities('1 hour')")).rows.map((r) => r.user_id as string);
    expect(listed).toContain(stale);
    for (const id of [recent, learner, admin]) expect(listed).not.toContain(id);
  });

  it("an intermediate identity cannot call it, and deleting it removes it cleanly", async () => {
    const id = await createAuthUser("ghost");
    expect((await attempt("authenticated", id, "select * from public.orphan_identities()")).code).toBe(DENIED);
    await q("delete from auth.users where id = $1", [id]);
    expect((await q("select count(*)::int n from auth.users where id = $1", [id])).rows[0].n).toBe(0);
  });
});
void iso;
