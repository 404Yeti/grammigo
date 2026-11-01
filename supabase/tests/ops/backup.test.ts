import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { exportAll, open, restoreAll, seal, TABLES, verifyBackup } from "../../../scripts/backup/lib.mjs";
import { DB_URL, closePool, docBody, put, q } from "../helpers";
import { createPerson } from "../auth/kit";

/**
 * The manual backup and restore, for real, against the LOCAL database. The restore is exercised inside a transaction that is rolled back, so the
 * shared test database is never changed; but it proves a backup restores into an emptied database to exactly the same rows.
 */
afterAll(closePool);
const PASS = "integration test passphrase 12345";
const ROOT = path.resolve(__dirname, "../../..");

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function seed() {
  const a = await createPerson({ label: "bk-a", learner: true });
  const b = await createPerson({ label: "bk-b", learner: true, admin: true });
  await put(a.id, "lessons_v2", 0, docBody("lessons_v2", { marker: "BACKUP-A" }));
  await put(a.id, "guided_v1", 0, docBody("guided_v1"));
  await put(a.id, "guided_v1", 1, docBody("guided_v1", { n: 2 }));
  await q("insert into public.invitations (label, code_hash, code_hint, max_uses, expires_at) values ('bk', gen_random_bytes(32), 'ABCD', 3, now() + interval '1 day')");
  await q("insert into public.deletion_ledger (user_hash) values (gen_random_bytes(32))");
  return { a, b };
}

describe("backup and restore against the local database", () => {
  it("exports every table, with counts and checksums that verify", async () => {
    const { a } = await seed();
    const data = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    expect(verifyBackup(data)).toBe(true);
    expect(Object.keys(data.tables).sort()).toEqual(TABLES.map(([s, t]: string[]) => `${s}.${t}`).sort());
    expect(data.counts["public.learner_documents"]).toBeGreaterThanOrEqual(2);
    expect(data.counts["public.learner_document_versions"]).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(data.tables["public.learner_documents"])).toContain("BACKUP-A");
    expect(data.tables["auth.users"].some((u: { id: string }) => u.id === a.id)).toBe(true);
    expect(data.migrations.length).toBeGreaterThanOrEqual(8);
  });

  it("the sealed file holds none of it in the clear, and opens again", async () => {
    await seed();
    const data = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    const file = seal(data, PASS);
    expect(file.toString("latin1")).not.toContain("BACKUP-A");
    expect(open(file, PASS).counts).toEqual(data.counts);
  });

  it("a backup restores into an EMPTIED database to exactly the same rows (checksums match table by table), and is then rolled back", async () => {
    await seed();
    const data = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    const after = await withClient(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(`truncate ${TABLES.map(([s, t]: string[]) => `"${s}"."${t}"`).join(", ")} cascade`);
      let restored: Awaited<ReturnType<typeof exportAll>> | undefined;
      const r = await restoreAll(c, data, { dryRun: true, beforeEnd: async () => { restored = await exportAll((sql: string) => c.query(sql)); } });
      expect(r.dryRun).toBe(true);
      return restored!;
    });
    expect(after.sha256).toEqual(data.sha256);
    expect(after.counts).toEqual(data.counts);
    // the dry run left the shared database exactly as it was
    const now = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    expect(now.counts).toEqual(data.counts);
  });

  it("refuses to restore over a database that already has rows, and changes nothing", async () => {
    await seed();
    const data = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    await withClient(async (c) => {
      await expect(restoreAll(c, data, { dryRun: false })).rejects.toThrow(/refusing to restore/);
    });
    const now = await withClient((c) => exportAll((sql: string) => c.query(sql)));
    expect(now.counts["public.profiles"]).toBe(data.counts["public.profiles"]);
  });

  it("the command-line tool writes an encrypted, owner-only file outside the repository, refuses to overwrite, and refuses the repository", async () => {
    await seed();
    const dir = mkdtempSync(path.join(tmpdir(), "gm-cli-backup-"));
    const out = path.join(dir, "test.gmbackup");
    const env = { ...process.env, SUPABASE_DB_URL: DB_URL, BACKUP_PASSPHRASE: PASS };
    try {
      const ok = spawnSync("node", ["scripts/backup/backup.mjs", "--out", out], { cwd: ROOT, env, encoding: "utf8" });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toMatch(/encrypted, owner-readable only/);
      expect(ok.stdout + ok.stderr).not.toContain(PASS);
      expect(ok.stdout + ok.stderr).not.toContain(DB_URL);
      const fd = openSync(out, "r"); // one handle for both the permission check and the read
      try {
        expect(fstatSync(fd).mode & 0o077).toBe(0);
        expect(verifyBackup(open(readFileSync(fd), PASS))).toBe(true);
      } finally {
        closeSync(fd);
      }
      const again = spawnSync("node", ["scripts/backup/backup.mjs", "--out", out], { cwd: ROOT, env, encoding: "utf8" });
      expect(again.status).toBe(2);
      const inRepo = path.join(ROOT, "should-not-exist.gmbackup");
      const refused = spawnSync("node", ["scripts/backup/backup.mjs", "--out", inRepo], { cwd: ROOT, env, encoding: "utf8" });
      expect(refused.status).toBe(2);
      expect(existsSync(inRepo)).toBe(false);
      const noPass = spawnSync("node", ["scripts/backup/backup.mjs", "--out", path.join(dir, "x.gmbackup")], { cwd: ROOT, env: { ...env, BACKUP_PASSPHRASE: "" }, encoding: "utf8" });
      expect(noPass.status).toBe(2);
      // restoring the file into this (non-empty) database is refused by the tool too, and says nothing about the data
      const restore = spawnSync("node", ["scripts/backup/restore.mjs", "--file", out], { cwd: ROOT, env, encoding: "utf8" });
      expect(restore.status).toBe(1);
      expect(restore.stderr).toMatch(/refusing to restore/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
