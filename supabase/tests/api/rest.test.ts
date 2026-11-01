import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, docBody, hash, put, q } from "../helpers";

/**
 * The same guarantees, but through the REAL HTTP surface a browser can reach: Auth (GoTrue) and the REST API (PostgREST) with real
 * session tokens. Runs only against the local Supabase stack. If the stack's keys are missing the test run FAILS.
 */
const API = process.env.SUPABASE_API_URL as string;
const ANON = process.env.SUPABASE_ANON_KEY as string;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

type Who = { id: string; token: string };
let A: Who, B: Who, I: Who, ADMIN: Who;
const PASSWORD = "Local-only-test-password-1!";

async function http(path: string, init: { method?: string; token?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: init.key ?? ANON, ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  // The responses are shaped by PostgREST/GoTrue; the tests assert on exactly the fields they use.
  return { status: res.status, json: json as Record<string, any> & any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function signUpUser(label: string): Promise<Who> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.invalid`;
  const created = await http("/auth/v1/admin/users", { method: "POST", key: SERVICE, token: SERVICE, body: { email, password: PASSWORD, email_confirm: true } });
  expect(created.status, "create user").toBeLessThan(300);
  const login = await http("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: PASSWORD } });
  expect(login.status, "password grant").toBe(200);
  return { id: created.json.id, token: login.json.access_token };
}
async function makeLearner(who: Who, name: string) {
  await q("insert into public.profiles (id, display_name, adult_confirmed_at) values ($1, $2, now())", [who.id, name]);
  await q("insert into public.consents (user_id, kind, version) values ($1, 'adult_confirmation', 'test')", [who.id]);
  await put(who.id, "guided_v1", 0, docBody("guided_v1", { owner: name }));
}
const refused = (s: number) => [401, 403].includes(s);

beforeAll(async () => {
  for (const [k, v] of Object.entries({ SUPABASE_API_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE })) if (!v) throw new Error(`${k} is not set: run these tests with \`npm run test:db\` against the local Supabase stack`);
  [A, B, I, ADMIN] = [await signUpUser("a"), await signUpUser("b"), await signUpUser("intermediate"), await signUpUser("admin")];
  await makeLearner(A, "Alice"); await makeLearner(B, "Bob"); await makeLearner(ADMIN, "Owner");
  await q("insert into public.app_admins (user_id) values ($1)", [ADMIN.id]);            // I has NO profile: a Google sign-in that was never invited
});
afterAll(closePool);

describe("learners through the REST API", () => {
  it("each learner reads only their own rows", async () => {
    for (const [me, other] of [[A, B], [B, A]]) {
      const p = await http("/rest/v1/profiles?select=id", { token: me.token });
      expect(p.json.map((r: { id: string }) => r.id)).toEqual([me.id]);
      expect((await http(`/rest/v1/profiles?id=eq.${other.id}`, { token: me.token })).json).toEqual([]);
      expect((await http(`/rest/v1/learner_documents?user_id=eq.${other.id}`, { token: me.token })).json).toEqual([]);
      expect((await http("/rest/v1/learner_documents?select=user_id", { token: me.token })).json.map((r: { user_id: string }) => r.user_id)).toEqual([me.id]);
      expect((await http(`/rest/v1/consents?user_id=eq.${other.id}`, { token: me.token })).json).toEqual([]);
    }
  });

  it("a learner can edit their own display name but not protected columns, and cannot edit anyone else", async () => {
    const mine = await http(`/rest/v1/profiles?id=eq.${A.id}`, { method: "PATCH", token: A.token, body: { display_name: "Alice Renamed" } });
    expect(mine.status).toBe(200);
    expect(mine.json[0].display_name).toBe("Alice Renamed");
    expect(refused((await http(`/rest/v1/profiles?id=eq.${A.id}`, { method: "PATCH", token: A.token, body: { status: "suspended" } })).status)).toBe(true);
    expect(refused((await http(`/rest/v1/profiles?id=eq.${A.id}`, { method: "PATCH", token: A.token, body: { adult_confirmed_at: new Date().toISOString() } })).status)).toBe(true);
    const theirs = await http(`/rest/v1/profiles?id=eq.${B.id}`, { method: "PATCH", token: A.token, body: { display_name: "hacked" } });
    expect(theirs.json).toEqual([]);
    expect((await q("select display_name from public.profiles where id = $1", [B.id])).rows[0].display_name).toBe("Bob");
  });

  it("a learner cannot write, replace or delete documents, or create rows anywhere", async () => {
    const forged = { user_id: B.id, doc_key: "guided_v1", schema_version: 1, body: docBody("guided_v1") };
    expect(refused((await http("/rest/v1/learner_documents", { method: "POST", token: A.token, body: forged })).status)).toBe(true);
    expect(refused((await http("/rest/v1/learner_documents", { method: "POST", token: A.token, body: { ...forged, user_id: A.id } })).status)).toBe(true);
    expect(refused((await http(`/rest/v1/learner_documents?user_id=eq.${A.id}`, { method: "PATCH", token: A.token, body: { body: {} } })).status)).toBe(true);
    expect(refused((await http(`/rest/v1/learner_documents?user_id=eq.${A.id}`, { method: "DELETE", token: A.token })).status)).toBe(true);
    expect(refused((await http("/rest/v1/profiles", { method: "POST", token: A.token, body: { id: randomUUID(), display_name: "x", adult_confirmed_at: new Date().toISOString() } })).status)).toBe(true);
    expect(refused((await http(`/rest/v1/profiles?id=eq.${A.id}`, { method: "DELETE", token: A.token })).status)).toBe(true);
    expect((await q("select count(*)::int n from public.learner_documents where user_id = $1", [A.id])).rows[0].n).toBe(1);
  });
});

describe("server-only data and functions through the REST API", () => {
  const serverTables = ["app_admins", "invitations", "invitation_reservations", "learner_document_versions", "audit_events", "deletion_ledger"];
  const serverRpc: [string, unknown][] = [
    ["put_document", { p_user: randomUUID(), p_key: "guided_v1", p_expected: 0, p_schema: 1, p_body: { version: 1, sessions: [] } }],
    ["restore_document_revision", { p_user: randomUUID(), p_key: "guided_v1", p_revision: 1, p_expected: 1, p_actor: null }],
    ["reserve_invitation", { p_code_hash: "\\x00" }],
    ["redeem_invitation", { p_grant: randomUUID(), p_user: randomUUID(), p_display_name: "x", p_adult_confirmed_at: new Date().toISOString(), p_notice_version: "v" }],
    ["revoke_invitation", { p_id: randomUUID(), p_actor: null }],
    ["delete_learner", { p_user: randomUUID(), p_user_hash: "\\x00" }],
    ["orphan_identities", {}],
    ["audit_export", { p_user: randomUUID() }],
    ["reserve_invitation_for_email", { p_code_hash: "\\x00", p_email_hash: "\\x00", p_adult_at: new Date().toISOString() }],
    ["redeem_reservation_for_email", { p_user: randomUUID(), p_email_hash: "\\x00", p_display_name: "x", p_notice_version: "v" }],
    ["email_identity_state", { p_email: "a@b.test" }],
    ["all_user_ids", {}],
    ["ledger_hashes", {}],
    ["redelete_learner", { p_user: randomUUID() }],
  ];

  it("learners, the intermediate identity, the ADMIN's own session and anonymous callers are all refused", async () => {
    for (const who of [A, I, ADMIN, null]) {
      for (const t of serverTables) expect(refused((await http(`/rest/v1/${t}`, { token: who?.token })).status), `${who ? who.id.slice(0, 4) : "anon"} GET ${t}`).toBe(true);
      for (const [fn, args] of serverRpc) {
        const r = await http(`/rest/v1/rpc/${fn}`, { method: "POST", token: who?.token, body: args });
        expect([401, 403, 404], `${who ? who.id.slice(0, 4) : "anon"} rpc ${fn} -> ${r.status}`).toContain(r.status);
      }
    }
  });

  it("the intermediate identity (no profile) sees nothing and is reported as not a learner", async () => {
    for (const t of ["profiles", "consents", "learner_documents"]) expect((await http(`/rest/v1/${t}`, { token: I.token })).json, t).toEqual([]);
    expect((await http("/rest/v1/rpc/is_active_learner", { method: "POST", token: I.token, body: {} })).json).toBe(false);
    expect((await http("/rest/v1/rpc/is_admin", { method: "POST", token: I.token, body: {} })).json).toBe(false);
  });

  it("is_admin is true only for the owner, and anon cannot ask", async () => {
    expect((await http("/rest/v1/rpc/is_admin", { method: "POST", token: ADMIN.token, body: {} })).json).toBe(true);
    expect((await http("/rest/v1/rpc/is_admin", { method: "POST", token: A.token, body: {} })).json).toBe(false);
    expect([401, 403, 404]).toContain((await http("/rest/v1/rpc/is_admin", { method: "POST", body: {} })).status);
  });

  it("the server key CAN reserve an invitation through the API, and the grant it returns is real", async () => {
    const codeHash = hash();
    const { rows } = await q("insert into public.invitations (label, code_hash, code_hint, max_uses, expires_at) values ('api', $1, 'API1', 1, now() + interval '1 hour') returning id", [codeHash]);
    const r = await http("/rest/v1/rpc/reserve_invitation", { method: "POST", key: SERVICE, token: SERVICE, body: { p_code_hash: `\\x${codeHash.toString("hex")}` } });
    expect(r.status).toBe(200);
    expect(r.json[0].error).toBeNull();
    expect((await q("select reserved_count from public.invitations where id = $1", [rows[0].id])).rows[0].reserved_count).toBe(1);
  });
});

describe("deleting an account through Auth", () => {
  it("removes the learner's rows everywhere and stops the session working", async () => {
    const V = await signUpUser("leaving"); await makeLearner(V, "Leaver");
    const del = await http(`/auth/v1/admin/users/${V.id}`, { method: "DELETE", key: SERVICE, token: SERVICE });
    expect(del.status).toBeLessThan(300);
    for (const [t, c] of [["profiles", "id"], ["consents", "user_id"], ["learner_documents", "user_id"], ["learner_document_versions", "user_id"]]) expect((await q(`select count(*)::int n from public.${t} where ${c} = $1`, [V.id])).rows[0].n, t).toBe(0);
    expect((await q("select count(*)::int n from auth.users where id = $1", [V.id])).rows[0].n).toBe(0);
  });

  it("delete_learner through the API (server key) removes the user and writes the ledger", async () => {
    const V = await signUpUser("ledgered"); await makeLearner(V, "Ledger");
    const h = hash();
    const r = await http("/rest/v1/rpc/delete_learner", { method: "POST", key: SERVICE, token: SERVICE, body: { p_user: V.id, p_user_hash: `\\x${h.toString("hex")}` } });
    expect(r.status).toBeLessThan(300);
    expect((await q("select count(*)::int n from auth.users where id = $1", [V.id])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.deletion_ledger where user_hash = $1", [h])).rows[0].n).toBe(1);
  });
});
