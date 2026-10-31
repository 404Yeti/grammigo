import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DENIED, attempt, closePool, createAdmin, createAuthUser, createInvitation, createLearner, docBody, put, q, reserve } from "../helpers";

/**
 * Cross-account isolation at the database. Actors: learners A and B, an "intermediate identity" I (a Google sign-in with NO
 * profile), the owner/admin, an anonymous caller, and the server (service_role). Every table and every function is exercised.
 */
let A: string, B: string, I: string, ADMIN: string;

beforeAll(async () => {
  [A, B, ADMIN] = [await createLearner("a", "Alice"), await createLearner("b", "Bob"), await createAdmin()];
  I = await createAuthUser("intermediate");
  for (const u of [A, B]) {
    await put(u, "lessons_v2", 0, docBody("lessons_v2", { marker: u }));
    await put(u, "guided_v1", 0, docBody("guided_v1", { marker: u }));
  }
  const inv = await createInvitation();
  await reserve(inv.codeHash);
});
afterAll(closePool);

const TABLES = ["app_admins", "invitations", "invitation_reservations", "profiles", "consents", "learner_documents", "learner_document_versions", "audit_events", "deletion_ledger"];
const SERVER_ONLY = ["app_admins", "invitations", "invitation_reservations", "learner_document_versions", "audit_events", "deletion_ledger"];

describe("reading", () => {
  it("a learner sees exactly their own profile, consents and documents, never anyone else's", async () => {
    for (const [me, other] of [[A, B], [B, A]]) {
      expect((await attempt("authenticated", me, "select * from public.profiles")).rows).toBe(1);
      expect((await attempt("authenticated", me, "select * from public.profiles where id = $1", [other])).rows).toBe(0);
      expect((await attempt("authenticated", me, "select * from public.consents")).rows).toBe(1);
      expect((await attempt("authenticated", me, "select * from public.consents where user_id = $1", [other])).rows).toBe(0);
      expect((await attempt("authenticated", me, "select * from public.learner_documents")).rows).toBe(2);
      expect((await attempt("authenticated", me, "select * from public.learner_documents where user_id = $1", [other])).rows).toBe(0);
    }
  });

  it("the owner/admin has NO special read access to learners' data through the client role", async () => {
    expect((await attempt("authenticated", ADMIN, "select * from public.profiles where id <> $1", [ADMIN])).rows).toBe(0);
    expect((await attempt("authenticated", ADMIN, "select * from public.learner_documents")).rows).toBe(0);
    expect((await attempt("authenticated", ADMIN, "select * from public.consents where user_id <> $1", [ADMIN])).rows).toBe(0);
  });

  it("an intermediate identity (Google sign-in, no profile) reads nothing at all", async () => {
    for (const t of ["profiles", "consents", "learner_documents"]) expect((await attempt("authenticated", I, `select * from public.${t}`)).rows, t).toBe(0);
    expect((await attempt("authenticated", I, "select public.is_active_learner() as a")).rows).toBe(1);
    const r = await (async () => { const { as } = await import("../helpers"); return as("authenticated", I, (qq) => qq("select public.is_active_learner() as a, public.is_admin() as b")); })();
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });

  it("a suspended learner loses access immediately", async () => {
    const S = await createLearner("suspended");
    await put(S, "guided_v1", 0, docBody("guided_v1"));
    expect((await attempt("authenticated", S, "select * from public.learner_documents")).rows).toBe(1);
    await q("update public.profiles set status = 'suspended' where id = $1", [S]);
    for (const t of ["profiles", "consents", "learner_documents"]) expect((await attempt("authenticated", S, `select * from public.${t}`)).rows, t).toBe(0);
  });

  it("server-only tables are refused outright (permission denied) for learners, the admin, the intermediate identity and anon", async () => {
    for (const t of SERVER_ONLY) {
      for (const [role, user] of [["authenticated", A], ["authenticated", ADMIN], ["authenticated", I], ["anon", null]] as const) {
        expect((await attempt(role, user, `select * from public.${t}`)).code, `${role} ${t}`).toBe(DENIED);
      }
    }
  });

  it("anon is refused on every table", async () => {
    for (const t of TABLES) expect((await attempt("anon", null, `select * from public.${t}`)).code, t).toBe(DENIED);
  });

  it("the server (service_role) can read everything", async () => {
    for (const t of TABLES) expect((await attempt("service_role", null, `select * from public.${t}`)).code, t).toBeUndefined();
  });
});

describe("writing", () => {
  it("a learner can change their own display name and preferences", async () => {
    const r = await attempt("authenticated", A, "update public.profiles set display_name = 'Alice 2', preferences = '{\"dailyMinutes\":10}' where id = $1", [A]);
    expect(r).toEqual({ rows: 1 });
    // (rolled back by the helper) so check through the server that the helper really did not persist it
    expect((await q("select display_name from public.profiles where id = $1", [A])).rows[0].display_name).toBe("Alice");
  });

  it("a learner cannot touch another learner's profile (0 rows), and cannot change protected columns (permission denied)", async () => {
    expect((await attempt("authenticated", A, "update public.profiles set display_name = 'hacked' where id = $1", [B])).rows).toBe(0);
    for (const col of ["status = 'suspended'", "adult_confirmed_at = now()", "joined_via_invitation = null", "id = gen_random_uuid()", "created_at = now()", "updated_at = now()"]) {
      expect((await attempt("authenticated", A, `update public.profiles set ${col} where id = $1`, [A])).code, col).toBe(DENIED);
    }
  });

  it("learners cannot insert, delete or truncate anything, anywhere", async () => {
    const ins: Record<string, string> = {
      profiles: "insert into public.profiles (id, display_name, adult_confirmed_at) values (gen_random_uuid(), 'x', now())",
      consents: "insert into public.consents (user_id, kind, version) values (gen_random_uuid(), 'adult_confirmation', 'x')",
      learner_documents: "insert into public.learner_documents (user_id, doc_key, schema_version, body) values (gen_random_uuid(), 'guided_v1', 1, '{\"version\":1,\"sessions\":[]}')",
    };
    for (const t of TABLES) {
      for (const role of ["authenticated", "anon"] as const) {
        const user = role === "authenticated" ? A : null;
        expect((await attempt(role, user, `delete from public.${t}`)).code, `${role} delete ${t}`).toBe(DENIED);
        expect((await attempt(role, user, `truncate public.${t}`)).code, `${role} truncate ${t}`).toBe(DENIED);
        const sql = ins[t] ?? `insert into public.${t} default values`;
        expect((await attempt(role, user, sql)).code, `${role} insert ${t}`).toBe(DENIED);
      }
    }
  });

  it("a learner (or the admin, or an intermediate identity) cannot write a document or forge another learner's", async () => {
    for (const who of [A, ADMIN, I]) {
      expect((await attempt("authenticated", who, "update public.learner_documents set body = '{}'")).code).toBe(DENIED);
      expect((await attempt("authenticated", who, "select * from public.put_document($1, 'guided_v1', 0, 1, '{\"version\":1,\"sessions\":[]}'::jsonb)", [B])).code).toBe(DENIED);
    }
  });
});

describe("functions", () => {
  const serverFns = [
    "select * from public.put_document(gen_random_uuid(), 'guided_v1', 0, 1, '{\"version\":1,\"sessions\":[]}'::jsonb)",
    "select * from public.restore_document_revision(gen_random_uuid(), 'guided_v1', 1, 1, null)",
    "select * from public.reserve_invitation('\\x00'::bytea)",
    "select public.redeem_invitation(gen_random_uuid(), gen_random_uuid(), 'x', now(), 'v')",
    "select public.revoke_invitation(gen_random_uuid(), null)",
    "select public.delete_learner(gen_random_uuid(), '\\x00'::bytea)",
    "select * from public.orphan_identities()",
    "select public.valid_document('guided_v1', 1, '{}'::jsonb)",
  ];
  it("no client role (learner, admin, intermediate identity, anon) can execute any server function", async () => {
    for (const sql of serverFns) for (const [role, user] of [["authenticated", A], ["authenticated", ADMIN], ["authenticated", I], ["anon", null]] as const) {
      expect((await attempt(role, user, sql)).code, `${role}: ${sql.slice(0, 40)}`).toBe(DENIED);
    }
  });

  it("is_active_learner and is_admin tell the truth, and only to signed-in users", async () => {
    const { as } = await import("../helpers");
    const ask = (u: string) => as("authenticated", u, (qq) => qq("select public.is_active_learner() a, public.is_admin() b")).then((r) => r.rows[0]);
    expect(await ask(A)).toEqual({ a: true, b: false });
    expect(await ask(ADMIN)).toEqual({ a: true, b: true });
    expect(await ask(I)).toEqual({ a: false, b: false });
    expect((await attempt("anon", null, "select public.is_active_learner()")).code).toBe(DENIED);
  });
});
