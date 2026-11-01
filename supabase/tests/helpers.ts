import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

export const DB_URL = process.env.SUPABASE_DB_URL as string;
export const pool = new pg.Pool({ connectionString: DB_URL, max: 40 });

export type Role = "anon" | "authenticated" | "service_role";

/** Runs `fn` in a transaction as a Supabase role, with the JWT claims PostgREST would set. Always rolled back. */
export async function as<T>(role: Role, userId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const claims = userId ? { sub: userId, role } : { role };
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)", [JSON.stringify(claims), userId ?? "", role]);
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** The outcome of one statement as one role: rows, an affected-row count, or the Postgres error code. */
export async function attempt(role: Role, userId: string | null, sql: string, params: unknown[] = []): Promise<{ rows: number; code?: string; message?: string }> {
  try {
    const r = await as(role, userId, (q) => q(sql, params));
    return { rows: r.rowCount ?? r.rows.length };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { rows: 0, code: err.code, message: err.message };
  }
}
export const DENIED = "42501"; // insufficient_privilege (also what a violated RLS WITH CHECK reports)

export const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

export const newId = () => randomUUID();
export const hash = () => randomBytes(32);
export const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/** An auth user as the server would see it. Inserted directly (the HTTP layer is covered by the api tests). */
export async function createAuthUser(label = "user"): Promise<string> {
  const id = randomUUID();
  await q("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [id, `${label}-${id.slice(0, 8)}@test.invalid`]);
  return id;
}

/** A learner as it exists after a successful redemption: auth user + active profile (+ consents), created as the SERVER does. */
export async function createLearner(label = "learner", name = "Test"): Promise<string> {
  const id = await createAuthUser(label);
  await q("insert into public.profiles (id, display_name, adult_confirmed_at) values ($1, $2, now())", [id, name]);
  await q("insert into public.consents (user_id, kind, version) values ($1, 'adult_confirmation', 'test')", [id]);
  return id;
}

export async function createAdmin(): Promise<string> {
  const id = await createLearner("admin", "Owner");
  await q("insert into public.app_admins (user_id) values ($1)", [id]);
  return id;
}

export async function createInvitation(opts: { max?: number; expiresInMs?: number; revoked?: boolean; label?: string } = {}) {
  const codeHash = hash();
  const { rows } = await q("insert into public.invitations (label, code_hash, code_hint, max_uses, expires_at, revoked_at) values ($1, $2, 'TEST', $3, $4, $5) returning id", [
    opts.label ?? "test invitation", codeHash, opts.max ?? 1, iso(opts.expiresInMs ?? 3_600_000), opts.revoked ? iso() : null,
  ]);
  return { id: rows[0].id as string, codeHash };
}

export async function reserve(codeHash: Buffer, hold = "30 minutes") {
  const { rows } = await q("select * from public.reserve_invitation($1, $2::interval)", [codeHash, hold]);
  return rows[0] as { grant_id: string | null; error: string | null };
}

export async function redeem(grant: string, user: string) {
  const { rows } = await q("select public.redeem_invitation($1, $2, 'Test', now(), 'test') as r", [grant, user]);
  return rows[0].r as string;
}

export const docBody = (key: "lessons_v2" | "guided_v1", extra: Record<string, unknown> = {}) =>
  key === "lessons_v2" ? { version: 2, sessions: [], activeSessionId: null, onboarding: { status: "skipped" }, goals: null, diagnosticRuns: [], writingFeedback: {}, ...extra } : { version: 1, sessions: [], activeSessionId: null, ...extra };
export const schemaOf = (key: "lessons_v2" | "guided_v1") => (key === "lessons_v2" ? 2 : 1);

export async function put(user: string, key: "lessons_v2" | "guided_v1", expected: number, body: unknown, schema = schemaOf(key)) {
  // Storing progress needs the learner's recorded consent (enforced by the database); these tests are about the documents, so grant it.
  await q("insert into public.consents (user_id, kind, version) select $1, 'cloud_storage', 'test' where not exists (select 1 from public.consents where user_id = $1 and kind = 'cloud_storage')", [user]);
  const { rows } = await q("select * from public.put_document($1, $2, $3, $4, $5::jsonb)", [user, key, expected, schema, JSON.stringify(body)]);
  return rows[0] as { ok: boolean; revision: string; error: string | null };
}

export async function closePool() {
  await pool.end();
}
