import { afterAll, describe, expect, it } from "vitest";
import { closePool, pool, q } from "../helpers";

/**
 * The catalogue test: it describes EVERY table and function in the public schema and who may touch it. A new table or function
 * that is not listed here FAILS this test, so nothing can be added without deciding (and testing) its access.
 */
type Priv = "select" | "insert" | "update" | "delete" | "truncate" | "references" | "trigger";
const ALL: Priv[] = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

const TABLES: Record<string, { authenticated: Priv[]; updatableColumns?: string[]; learnerFacing?: boolean }> = {
  app_admins: { authenticated: [] },
  invitations: { authenticated: [] },
  invitation_reservations: { authenticated: [] },
  profiles: { authenticated: ["select"], updatableColumns: ["display_name", "first_language", "time_zone", "preferences"] },
  consents: { authenticated: ["select"] },
  learner_documents: { authenticated: ["select"] },
  learner_document_versions: { authenticated: [] },
  audit_events: { authenticated: [] },
  deletion_ledger: { authenticated: [] },
  rate_limits: { authenticated: [] },
};

type Who = "learner" | "server" | "nobody";
const FUNCTIONS: Record<string, Who> = {
  is_active_learner: "learner",
  is_admin: "learner",
  valid_document: "server",
  put_document: "server",
  restore_document_revision: "server",
  reserve_invitation: "server",
  redeem_invitation: "server",
  revoke_invitation: "server",
  delete_learner: "server",
  orphan_identities: "server",
  rate_limit_hit: "server",
  prune_rate_limits: "server",
  release_reservation: "server",
  release_expired_reservations: "server",
  purge_orphan_identity: "server",
  purge_orphan_identities: "server",
  create_invitation: "server",
  touch_updated_at: "nobody",
  audit_events_guard: "nobody",
  deletion_ledger_guard: "nobody",
};

afterAll(closePool);

describe("tables", () => {
  it("every public table is listed here, and has row-level security enabled", async () => {
    const { rows } = await q("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'");
    expect(rows.map((r) => r.relname).sort()).toEqual(Object.keys(TABLES).sort());
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("anon has NO privilege of any kind on any table", async () => {
    const bad: string[] = [];
    for (const t of Object.keys(TABLES)) for (const p of ALL) {
      const { rows } = await q("select has_table_privilege('anon', $1, $2) as ok", [`public.${t}`, p]);
      if (rows[0].ok) bad.push(`${t}:${p}`);
    }
    expect(bad).toEqual([]);
  });

  it("authenticated has exactly the listed privileges, no more", async () => {
    const wrong: string[] = [];
    for (const [t, spec] of Object.entries(TABLES)) for (const p of ALL) {
      const { rows } = await q("select has_table_privilege('authenticated', $1, $2) as ok", [`public.${t}`, p]);
      if (rows[0].ok !== spec.authenticated.includes(p)) wrong.push(`${t}:${p}=${rows[0].ok}`);
    }
    expect(wrong).toEqual([]);
  });

  it("column-level update is limited to the four profile preferences; nothing else is updatable or insertable by a learner", async () => {
    const wrong: string[] = [];
    const { rows: cols } = await q("select table_name, column_name from information_schema.columns where table_schema = 'public'");
    for (const c of cols) {
      const allowed = TABLES[c.table_name]?.updatableColumns?.includes(c.column_name) ?? false;
      for (const role of ["anon", "authenticated"]) {
        const u = (await q("select has_column_privilege($1, $2, $3, 'update') as ok", [role, `public.${c.table_name}`, c.column_name])).rows[0].ok;
        const i = (await q("select has_column_privilege($1, $2, $3, 'insert') as ok", [role, `public.${c.table_name}`, c.column_name])).rows[0].ok;
        if (u !== (role === "authenticated" && allowed)) wrong.push(`${role} update ${c.table_name}.${c.column_name}=${u}`);
        if (i) wrong.push(`${role} insert ${c.table_name}.${c.column_name}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("service_role has full access to every table (it is the server)", async () => {
    const lacking: string[] = [];
    for (const t of Object.keys(TABLES)) for (const p of ["select", "insert", "update", "delete"] as Priv[]) {
      const { rows } = await q("select has_table_privilege('service_role', $1, $2) as ok", [`public.${t}`, p]);
      if (!rows[0].ok) lacking.push(`${t}:${p}`);
    }
    expect(lacking).toEqual([]);
  });
});

describe("functions", () => {
  it("every public function is listed here with who may execute it", async () => {
    const { rows } = await q("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'");
    expect([...new Set(rows.map((r) => r.proname as string))].sort()).toEqual(Object.keys(FUNCTIONS).sort());
  });

  it("execute rights match: learner functions to authenticated only; server functions to service_role only; nobody for triggers; never PUBLIC or anon", async () => {
    const { rows } = await q("select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'");
    const wrong: string[] = [];
    for (const f of rows) {
      const who = FUNCTIONS[f.proname as string];
      const can = async (role: string) => (await q("select has_function_privilege($1, $2::oid, 'execute') as ok", [role, f.oid])).rows[0].ok as boolean;
      const publicGrant = (await q("select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::oid and a.grantee = 0) as g", [f.oid])).rows[0].g;
      if (publicGrant) wrong.push(`${f.proname}: PUBLIC can execute`);
      if (await can("anon")) wrong.push(`${f.proname}: anon can execute`);
      if ((await can("authenticated")) !== (who === "learner")) wrong.push(`${f.proname}: authenticated=${await can("authenticated")}`);
      if (who === "server" && !(await can("service_role"))) wrong.push(`${f.proname}: service_role cannot execute`);
    }
    expect(wrong).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path (no search-path hijacking)", async () => {
    const { rows } = await q("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')");
    expect(rows).toEqual([]);
  });
});

describe("defaults", () => {
  it("an object created in the future starts with NO client access (default privileges are locked down)", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("create table public.zz_future_table (id int)");
      await client.query("create function public.zz_future_fn() returns int language sql as $$ select 1 $$");
      const t = await client.query("select has_table_privilege('anon','public.zz_future_table','select') a, has_table_privilege('authenticated','public.zz_future_table','select') b");
      const f = await client.query("select has_function_privilege('anon','public.zz_future_fn()','execute') a, has_function_privilege('authenticated','public.zz_future_fn()','execute') b");
      expect([t.rows[0].a, t.rows[0].b, f.rows[0].a, f.rows[0].b]).toEqual([false, false, false, false]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("every foreign key to auth.users is accounted for (so deletion tests cover it)", async () => {
    const { rows } = await q(`select conrelid::regclass::text as t, a.attname as col, c.confdeltype as del from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace`);
    const got = rows.map((r) => `${r.t}.${r.col}:${r.del === "c" ? "cascade" : r.del === "n" ? "set null" : r.del}`).sort();
    expect(got).toEqual([
      "app_admins.user_id:cascade", "audit_events.actor:set null", "consents.user_id:cascade", "invitation_reservations.user_id:set null",
      "invitations.created_by:set null", "learner_document_versions.user_id:cascade", "learner_documents.user_id:cascade", "profiles.id:cascade",
    ]);
  });
});
