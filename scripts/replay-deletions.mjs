#!/usr/bin/env node
// Re-applies account deletions after a database restore: every account whose keyed hash is in the deletion ledger is deleted again.
//
//   SUPABASE_DB_URL=postgres://...  INVITE_CODE_PEPPER=...  node scripts/replay-deletions.mjs            (dry run: lists nothing, only counts)
//   SUPABASE_DB_URL=postgres://...  INVITE_CODE_PEPPER=...  node scripts/replay-deletions.mjs --apply    (deletes)
//
// Run it against the RESTORED database, with the SAME INVITE_CODE_PEPPER the application uses, BEFORE sign-in is re-enabled. Idempotent. It
// never prints an id or hash. Against a hosted project it needs the explicit production approval described in docs/dev/deletion-and-restore.md.
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

/** MUST stay identical to ledgerHash() in src/lib/auth/lifecycle.ts. A test compares the two. */
export function ledgerHash(userId, pepper) {
  return createHmac("sha256", Buffer.from(pepper, "utf8")).update(`gm-deleted-v1:${userId.toLowerCase()}`).digest();
}

export async function replay({ query }, pepper, apply) {
  const ids = (await query("select * from public.all_user_ids() as id")).rows.map((r) => String(r.id));
  const wanted = new Set((await query("select * from public.ledger_hashes() as h")).rows.map((r) => Buffer.from(r.h).toString("hex")));
  const matches = ids.filter((id) => wanted.has(ledgerHash(id, pepper).toString("hex")));
  let deleted = 0;
  if (apply) for (const id of matches) if ((await query("select public.redelete_learner($1) as r", [id])).rows[0].r === true) deleted++;
  return { checked: ids.length, ledger: wanted.size, matches: matches.length, deleted };
}

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  const pepper = process.env.INVITE_CODE_PEPPER ?? "";
  if (!url || pepper.length < 32) {
    console.error("Set SUPABASE_DB_URL and INVITE_CODE_PEPPER (the same value the application uses, at least 32 characters).");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const out = await replay(client, pepper, apply);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...out }));
    if (out.ledger > 0 && out.matches === 0) console.error("WARNING: the ledger has entries but none matched an account. Either nobody needs deleting, or INVITE_CODE_PEPPER is not the key the ledger was written with.");
    if (apply && out.deleted !== out.matches) {
      console.error("Not every match could be deleted (an owner account is never deleted by this tool).");
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => (console.error("replay failed:", e.message), process.exit(1)));
