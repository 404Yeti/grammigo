#!/usr/bin/env node
// READ-ONLY production readiness checks. Safe to run: it performs GETs of public endpoints with the public anon key, SELECTs in a read-only
// database transaction, and inspects environment values. It changes nothing, applies nothing, and never prints a secret.
//
//   node scripts/check-production-readiness.mjs env  [--vars-file <path>] [--ref <project ref>]      (the only check that reads an env file; it sends nothing)
//   node scripts/check-production-readiness.mjs auth [--expect-google on|off]     needs SUPABASE_URL, SUPABASE_ANON_KEY
//   node scripts/check-production-readiness.mjs rest                               needs SUPABASE_URL, SUPABASE_ANON_KEY
//   node scripts/check-production-readiness.mjs db                                 needs SUPABASE_DB_URL (a read-only role is best)
//   node scripts/check-production-readiness.mjs all
//
// Values come from the environment of the terminal you run it in (or --vars-file, e.g. from `vercel env pull`: delete that file afterwards).
// Never paste a key into a chat or a ticket. The exit code is 1 if any check fails, 2 for a usage error.
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { checkAuthSettings, checkDatabase, checkEnvironment, checkRestSurface, redactor, renderReport, summarize } from "./readiness/checks.mjs";

export const EXPECTED_REF = "ugifdvaaaioiqmwfiksw";
export const expectedMigrationNames = (dir = new URL("../supabase/migrations/", import.meta.url)) => readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => f.replace(/^\d+_/, "").replace(/\.sql$/, ""));
export const expectedMigrations = (dir = new URL("../supabase/migrations/", import.meta.url)) => readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]).sort();

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Runs only SELECTs, in a transaction the server itself enforces as read-only. */
async function withReadOnlyDb(url, fn) {
  const client = new pg.Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=15000" });
  await client.connect();
  try {
    await client.query("begin read only");
    return await fn((sql) => client.query(sql));
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const arg = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (!["env", "auth", "rest", "db", "all"].includes(cmd ?? "")) {
    console.error("Usage: check-production-readiness.mjs env|auth|rest|db|all [--vars-file path] [--ref ref] [--expect-google on|off]");
    process.exit(2);
  }
  // An env file is read ONLY by the `env` check, which sends nothing anywhere. The checks that make requests (auth, rest, db) use the terminal's own
  // environment and never anything loaded from a file, so a changed file cannot redirect a key to another host.
  if (arg("vars-file") && cmd !== "env") { console.error("--vars-file is only used by the `env` check. Put values for the other checks in your terminal's environment."); process.exit(2); }
  const fileEnv = arg("vars-file") ? parseEnvFile(readFileSync(arg("vars-file"), "utf8")) : {};
  const shapeEnv = { ...process.env, ...fileEnv }; // used ONLY by the shape check below (it sends nothing) and the redactor
  const env = process.env; // every request-making check reads this and nothing from a file
  const redact = redactor(shapeEnv);
  const sections = [];
  const run = async (name, f) => {
    try { sections.push({ name, items: await f() }); }
    catch (e) { sections.push({ name, items: [{ id: "check could not run", ok: false, level: "fail", detail: redact(e.message ?? "error") }] }); }
  };
  const need = (...names) => { const m = names.filter((n) => !env[n]); if (m.length) throw new Error(`needs ${m.join(", ")} in the environment (names only; nothing was printed)`); };
  const wants = (n) => cmd === "all" || cmd === n;
  if (wants("env")) await run("environment (names and shape only)", async () => checkEnvironment(shapeEnv, { expectedRef: arg("ref") ?? EXPECTED_REF }));
  if (wants("auth")) await run("authentication settings (public endpoint)", async () => { need("SUPABASE_URL", "SUPABASE_ANON_KEY"); return checkAuthSettings({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, expectGoogle: (arg("expect-google") ?? "on") === "on" }); });
  if (wants("rest")) await run("Data API seen by an anonymous caller", async () => { need("SUPABASE_URL", "SUPABASE_ANON_KEY"); return checkRestSurface({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }); });
  if (wants("db")) await run("database (read-only)", async () => { need("SUPABASE_DB_URL"); return withReadOnlyDb(env.SUPABASE_DB_URL, (query) => checkDatabase(query, { expectedMigrations: expectedMigrations(), expectedMigrationNames: expectedMigrationNames(), platformFunctionsAllowed: [] })); });
  console.log(renderReport(sections, redact));
  process.exit(summarize(sections).failed === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
