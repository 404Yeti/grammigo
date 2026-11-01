#!/usr/bin/env node
// Owner tools that need the service role: create an invitation and make an existing learner an owner. Run on YOUR machine with the
// environment variables of the project you mean to change. Nothing here is reachable from the web.
//
//   node scripts/admin-cli.mjs invite  --label "Cohort 1" --seats 5 --days 14
//   node scripts/admin-cli.mjs grant-admin --user <auth user id>
//   node scripts/admin-cli.mjs suspended-find   --email <address>
//   node scripts/admin-cli.mjs suspended-export --user <id> --out <new file>
//   node scripts/admin-cli.mjs suspended-delete --user <id> --identity-verified
//   (the last three: ONLY after the steps in docs/dev/suspended-requests.md; they refuse anyone who is not a suspended, non-owner learner)
//
// Required environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INVITE_CODE_PEPPER (the SAME pepper the app uses).
// The invitation code is printed once, here, and never stored. Prefer the owner API in the app once an owner exists; this script is how
// the very first invitation (for the owner) is made.
import { createHmac, randomInt } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { deleteSuspended, exportSuspended, findSuspended } from "./suspended-requests.mjs";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const need = (name) => { const v = process.env[name]; if (!v) { console.error(`Missing ${name}`); process.exit(1); } return v; };

const [, , command] = process.argv;
const url = need("SUPABASE_URL");
const service = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

if (command === "invite") {
  const pepper = need("INVITE_CODE_PEPPER");
  if (pepper.length < 32) { console.error("INVITE_CODE_PEPPER must be at least 32 characters"); process.exit(1); }
  const label = arg("label", "Invitation");
  const seats = Number(arg("seats", "1"));
  const days = Number(arg("days", "14"));
  if (!Number.isInteger(seats) || seats < 1 || seats > 100 || !Number.isInteger(days) || days < 1 || days > 90) { console.error("--seats must be 1-100 and --days 1-90"); process.exit(1); }
  let code = "";
  for (let i = 0; i < 11; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  const hash = createHmac("sha256", Buffer.from(pepper)).update(`gm-invite-v1:${code}`).digest();
  const { data, error } = await service.rpc("create_invitation", {
    p_label: label, p_code_hash: `\\x${hash.toString("hex")}`, p_hint: code.slice(-4), p_max_uses: seats,
    p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString(), p_actor: null,
  });
  if (error) { console.error("Could not create the invitation."); process.exit(1); }
  console.log(`Invitation ${data} created for ${seats} seat(s), valid ${days} day(s).`);
  console.log(`Code (shown once): ${code.replace(/^(.{4})(.{4})(.*)$/, "$1-$2-$3")}`);
} else if (command === "grant-admin") {
  const user = arg("user");
  if (!user || !/^[0-9a-f-]{36}$/i.test(user)) { console.error("--user must be the auth user id"); process.exit(1); }
  const profile = await service.from("profiles").select("id").eq("id", user).maybeSingle();
  if (!profile.data) { console.error("That user is not an active learner. Join with an invitation first, then run this."); process.exit(1); }
  const { error } = await service.from("app_admins").insert({ user_id: user });
  if (error && !/duplicate/i.test(error.message)) { console.error("Could not grant."); process.exit(1); }
  console.log("Done. That learner can now manage invitations.");
} else if (command === "suspended-find") {
  const r = await findSuspended(service, arg("email", ""));
  console.log(r.found ? JSON.stringify({ found: true, id: r.id, suspended: r.suspended, owner: r.owner }) : JSON.stringify({ found: false }));
} else if (command === "suspended-export") {
  const out = arg("out");
  if (!out || existsSync(out)) { console.error("--out must name a file that does not exist yet"); process.exit(1); }
  try {
    const data = await exportSuspended(service, arg("user", ""));
    writeFileSync(out, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" }); // only the owner can read it
    console.log(`Wrote ${out} (owner-readable only): ${data.consents.length} consent record(s), ${data.progress.length} saved document(s). Deliver it as described in docs/dev/suspended-requests.md, then delete it.`);
  } catch (e) { console.error(e.message); process.exit(1); }
} else if (command === "suspended-delete") {
  if (!process.argv.includes("--identity-verified")) { console.error("Add --identity-verified only after completing the identity steps in docs/dev/suspended-requests.md"); process.exit(1); }
  try {
    await deleteSuspended(service, arg("user", ""), process.env.INVITE_CODE_PEPPER ?? "");
    console.log("Deleted, and recorded in the deletion ledger. Access was not restored at any point.");
  } catch (e) { console.error(e.message); process.exit(1); }
} else {
  console.error("Usage: admin-cli.mjs invite --label <text> --seats <1-100> --days <1-90>\n       admin-cli.mjs grant-admin --user <auth user id>\n       admin-cli.mjs suspended-find --email <address> | suspended-export --user <id> --out <file> | suspended-delete --user <id> --identity-verified");
  process.exit(1);
}
