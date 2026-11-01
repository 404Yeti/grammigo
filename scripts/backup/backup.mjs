#!/usr/bin/env node
// Manual encrypted backup of Grammigo's data (for a project without automatic backups).
//
//   SUPABASE_DB_URL=… BACKUP_PASSPHRASE=… node scripts/backup/backup.mjs --out ~/grammigo-backups/2026-11-02.gmbackup
//
// Both values come from YOUR terminal's environment; neither is ever printed. Read-only against the database (SELECTs in a read-only transaction).
// The output file is created new, owner-readable only, and the tool REFUSES to write inside a git working tree. Counts are printed, never rows.
import { closeSync, existsSync, fstatSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { exportAll, seal, verifyBackup, open } from "./lib.mjs";

/** True if `dir` or any parent contains a .git: backups holding personal data must never be inside a repository. */
export function insideGitTree(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(resolve(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = arg("out");
  const url = process.env.SUPABASE_DB_URL, pass = process.env.BACKUP_PASSPHRASE;
  if (!out || !url || !pass) { console.error("Needs --out <new file>, and SUPABASE_DB_URL and BACKUP_PASSPHRASE (16+ characters) in the environment. Nothing was printed or written."); process.exit(2); }
  if (insideGitTree(dirname(resolve(out)))) { console.error("Refusing to write a backup inside a git repository. Choose a folder outside any repository."); process.exit(2); }
  // Reserve the file name FIRST, atomically ("wx": create only if it does not exist, owner-readable only), so there is no gap between checking and writing.
  let fd;
  try { fd = openSync(out, "wx", 0o600); } catch (e) { console.error(e && e.code === "EEXIST" ? "That file already exists; choose a new name." : "Could not create the backup file there."); process.exit(2); }
  let done = false;
  const client = new pg.Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=60000" });
  await client.connect();
  try {
    await client.query("begin read only isolation level repeatable read"); // one consistent moment across all tables
    const data = await exportAll((sql) => client.query(sql));
    await client.query("rollback");
    verifyBackup(data);
    const file = seal(data, pass);
    writeSync(fd, file);
    open(file, pass); // prove it can be opened again before reporting success
    done = true;
    console.log(`Backup written (${fstatSync(fd).size} bytes, encrypted, owner-readable only). Rows saved: ${JSON.stringify(data.counts)}`);
  } finally {
    closeSync(fd);
    if (!done) { try { unlinkSync(out); } catch { /* nothing was written */ } } // never leave a partial backup behind
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error("backup failed:", e.message); process.exit(1); });
