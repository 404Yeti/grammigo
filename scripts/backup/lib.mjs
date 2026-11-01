// Manual backup and restore of Grammigo's data, for a Supabase project WITHOUT automatic backups (the Free plan).
//
// What is saved: everything the app keeps that cannot be recreated: the Auth users and their Google identities, profiles, consents, invitations and
// their reservations, the owner list, saved progress documents and their last revisions, the audit log and the deletion ledger. NOT saved:
// sessions and refresh tokens (people simply sign in again), rate-limit counters (disposable), and anything in the schema itself (the schema comes from
// the migrations in the repository, applied first).
//
// The file is compressed and ENCRYPTED (AES-256-GCM, key from a passphrase via scrypt) before it touches disk. It holds personal data: it must never
// be committed, emailed or stored unencrypted. Nothing here prints a row.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Parents before children. rate_limits is deliberately absent. */
export const TABLES = Object.freeze([
  ["auth", "users"], ["auth", "identities"],
  ["public", "app_admins"], ["public", "invitations"], ["public", "profiles"], ["public", "consents"],
  ["public", "invitation_reservations"], ["public", "learner_documents"], ["public", "learner_document_versions"],
  ["public", "audit_events"], ["public", "deletion_ledger"],
]);
const MAGIC = Buffer.from("GMBK1");
const q = (s, t) => `"${s}"."${t}"`;
const BATCH = 400;

/** Columns that can be written back: not generated columns. (auth.users and auth.identities each have one.) */
async function writableColumns(query, schema, table) {
  const r = await query(`select column_name as c, is_identity as ident from information_schema.columns where table_schema = '${schema}' and table_name = '${table}' and is_generated = 'NEVER' order by ordinal_position`);
  return r.rows.map((x) => ({ name: x.c, identity: x.ident === "YES" }));
}

/** @typedef {{ format: string, version: number, createdAt: string, migrations: string[], counts: Record<string, number>, sha256: Record<string, string>, tables: Record<string, any[]> }} Backup */
/**
 * @param {(sql: string) => Promise<{ rows: any[] }>} query
 * @param {Date} [now]
 * @returns {Promise<Backup>}
 */
export async function exportAll(query, now = new Date()) {
  const tables = {};
  const sha256 = {};
  for (const [schema, table] of TABLES) {
    const cols = (await writableColumns(query, schema, table)).map((c) => `"${c.name}"`).join(", ");
    const rows = (await query(`select row_to_json(t) as j from (select ${cols} from ${q(schema, table)}) t order by row_to_json(t)::text`)).rows.map((r) => r.j);
    tables[`${schema}.${table}`] = rows;
    sha256[`${schema}.${table}`] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  const migrations = (await query("select version::text as v from supabase_migrations.schema_migrations order by 1").catch(() => ({ rows: [] }))).rows.map((r) => r.v);
  return { format: "grammigo-backup", version: 1, createdAt: now.toISOString(), migrations, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), sha256, tables };
}

/** Every table's rows must hash to what the manifest says: a damaged or edited file is refused before anything is restored. */
export function verifyBackup(data) {
  if (!data || data.format !== "grammigo-backup" || data.version !== 1) throw new Error("not a Grammigo backup");
  for (const [schema, table] of TABLES) {
    const key = `${schema}.${table}`;
    const rows = data.tables?.[key];
    if (!Array.isArray(rows)) throw new Error(`the backup has no ${key}`);
    if (createHash("sha256").update(JSON.stringify(rows)).digest("hex") !== data.sha256?.[key]) throw new Error(`${key} does not match its checksum: the file is damaged or was changed`);
  }
  return true;
}

// ---------------------------------------------------------------- the file
export function seal(data, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 16) throw new Error("the passphrase must be at least 16 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data), "utf8"))), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
export function open(file, passphrase) {
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Grammigo backup file");
  const salt = file.subarray(5, 21), iv = file.subarray(21, 33), tag = file.subarray(33, 49), body = file.subarray(49);
  try {
    const d = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
    d.setAuthTag(tag);
    return JSON.parse(gunzipSync(Buffer.concat([d.update(body), d.final()])).toString("utf8"));
  } catch {
    throw new Error("could not open the file: wrong passphrase, or the file is damaged");
  }
}

// ---------------------------------------------------------------- restore (all or nothing)
/**
 * Restores into an EMPTY database (migrations applied, no Auth users, no app rows). One transaction: if anything fails, nothing is written.
 * `dryRun` does everything and then rolls back, to prove the file restores without changing the target.
 */
/**
 * @param {any} client
 * @param {Backup} data
 * @param {{ dryRun?: boolean, beforeEnd?: () => Promise<void> }} [options]
 */
export async function restoreAll(client, data, { dryRun = false, beforeEnd } = {}) {
  verifyBackup(data);
  await client.query("begin");
  try {
    for (const [schema, table] of TABLES) {
      const n = (await client.query(`select count(*)::int as n from ${q(schema, table)}`)).rows[0].n;
      if (n !== 0) throw new Error(`refusing to restore: ${schema}.${table} already has ${n} row(s). Restore only into an empty project`);
    }
    await client.query("set local session_replication_role = replica").catch(() => undefined); // rows go back exactly as saved (the audit/ledger guards are for later changes)
    for (const [schema, table] of TABLES) {
      const rows = data.tables[`${schema}.${table}`];
      if (rows.length === 0) continue;
      const cols = await writableColumns(client.query.bind(client), schema, table);
      const list = cols.map((c) => `"${c.name}"`).join(", ");
      const override = cols.some((c) => c.identity) ? " overriding system value" : "";
      for (let i = 0; i < rows.length; i += BATCH) {
        await client.query(`insert into ${q(schema, table)} (${list})${override} select ${list} from jsonb_populate_recordset(null::${q(schema, table)}, $1::jsonb)`, [JSON.stringify(rows.slice(i, i + BATCH))]);
      }
    }
    // keep the audit log's numbering going from where it was
    const max = (await client.query('select coalesce(max(id), 0) + 1 as n from "public"."audit_events"')).rows[0].n;
    await client.query(`alter table "public"."audit_events" alter column id restart with ${Number(max)}`);
    if (beforeEnd) await beforeEnd(); // lets a test look at the restored state before it is committed or rolled back
    await client.query(dryRun ? "rollback" : "commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  }
  return { restored: Object.fromEntries(TABLES.map(([s, t]) => [`${s}.${t}`, data.tables[`${s}.${t}`].length])), dryRun };
}
