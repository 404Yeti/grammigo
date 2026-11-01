#!/usr/bin/env node
// Restores a backup made by backup.mjs into an EMPTY project (the schema from the repository's migrations already applied, no users).
//
//   SUPABASE_DB_URL=… BACKUP_PASSPHRASE=… node scripts/backup/restore.mjs --file backup.gmbackup            (dry run: does everything, then rolls back)
//   SUPABASE_DB_URL=… BACKUP_PASSPHRASE=… node scripts/backup/restore.mjs --file backup.gmbackup --apply    (writes)
//
// One transaction: all or nothing. It refuses a non-empty target. Afterwards run scripts/replay-deletions.mjs with the app's INVITE_CODE_PEPPER so
// anyone whose deletion is in the ledger is deleted again. Prints counts only.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { open, restoreAll } from "./lib.mjs";

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const file = arg("file"), url = process.env.SUPABASE_DB_URL, pass = process.env.BACKUP_PASSPHRASE;
  if (!file || !url || !pass) { console.error("Needs --file <backup>, and SUPABASE_DB_URL and BACKUP_PASSPHRASE in the environment."); process.exit(2); }
  const data = open(readFileSync(file), pass);
  const client = new pg.Client({ connectionString: url, options: "-c statement_timeout=120000" });
  await client.connect();
  try {
    const apply = process.argv.includes("--apply");
    const r = await restoreAll(client, data, { dryRun: !apply });
    console.log(`${apply ? "RESTORED" : "DRY RUN OK (rolled back, nothing written)"} from a backup made ${data.createdAt}. Rows: ${JSON.stringify(r.restored)}`);
    if (apply) console.log("Next: run scripts/replay-deletions.mjs (dry run, then --apply) with the app's INVITE_CODE_PEPPER.");
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error("restore failed:", e.message); process.exit(1); });
