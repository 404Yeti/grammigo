#!/usr/bin/env node
// Runs the database tests against the LOCAL Supabase stack. Never touches a cloud project.
// It FAILS (exit 1) if the stack is not running; it never skips.
import { spawnSync } from "node:child_process";

const CLI = "supabase@2.122.0";
const status = spawnSync("npx", ["--yes", CLI, "status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0 || !status.stdout.includes("DB_URL")) {
  console.error("Supabase is not running locally.\n  Start it:    npx --yes " + CLI + " start\n  (Docker Desktop with WSL integration is required; see docs/dev/local-setup.md)\n" + (status.stderr || "").split("\n").slice(-4).join("\n"));
  process.exit(1);
}
const env = {};
for (const line of status.stdout.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}
const pick = (...names) => names.map((n) => env[n]).find(Boolean);
const dbUrl = pick("DB_URL");
const apiUrl = pick("API_URL");
const anon = pick("ANON_KEY", "PUBLISHABLE_KEY");
const service = pick("SERVICE_ROLE_KEY", "SECRET_KEY");
if (!dbUrl || !apiUrl || !anon || !service) {
  console.error("Could not read DB_URL / API_URL / anon / service keys from `supabase status`. Names found: " + Object.keys(env).join(", "));
  process.exit(1);
}
// Local demo values only; they are never printed.
const run = spawnSync("npx", ["vitest", "run", "-c", "vitest.db.config.mts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, SUPABASE_DB_URL: dbUrl, SUPABASE_API_URL: apiUrl, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service },
});
process.exit(run.status ?? 1);
