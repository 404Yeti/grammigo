#!/usr/bin/env node
// Builds the app with accounts ON and runs the accounts browser tests against the LOCAL Supabase stack. It never touches a cloud
// project and it FAILS (exit 1) when the stack is not running; it never skips.
import { spawnSync } from "node:child_process";

const CLI = "supabase@2.122.0";
const status = spawnSync("npx", ["--yes", CLI, "status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0 || !status.stdout.includes("DB_URL")) {
  console.error("Supabase is not running locally.\n  Start it: npx --yes " + CLI + " start\n  (see docs/dev/local-setup.md)");
  process.exit(1);
}
const env = {};
for (const line of status.stdout.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}
const pick = (...names) => names.map((n) => env[n]).find(Boolean);
const api = pick("API_URL");
const anon = pick("ANON_KEY", "PUBLISHABLE_KEY");
const service = pick("SERVICE_ROLE_KEY", "SECRET_KEY");
const dbUrl = pick("DB_URL");
if (!api || !anon || !service || !dbUrl) {
  console.error("Could not read the local stack's URL and keys. Names found: " + Object.keys(env).join(", "));
  process.exit(1);
}
const port = process.env.E2E_ACCOUNTS_PORT ?? "3100";
// Values for the LOCAL stack only. They are never printed. The secrets below are throwaway test values, not real ones.
const appEnv = {
  ...process.env,
  NEXT_PUBLIC_ACCOUNTS: "on",
  NEXT_DIST_DIR: ".next-accounts",
  SUPABASE_URL: api,
  SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  SUPABASE_API_URL: api,
  SUPABASE_DB_URL: dbUrl,
  INVITE_CODE_PEPPER: "e2e-pepper-e2e-pepper-e2e-pepper-0000",
  AUTH_FLOW_SECRET: "e2e-flow-secret-e2e-flow-secret-0000",
  CRON_SECRET: "e2e-cron-secret-e2e-cron-secret-0000",
  AUTH_SITE_URL: `http://localhost:${port}`,
  AI_FEATURES_ENABLED: "false",
};
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", env: appEnv });
if (!process.env.SKIP_BUILD) {
  const build = run("npx", ["next", "build"]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const tests = run("npx", ["playwright", "test", "-c", "playwright.accounts.config.ts", ...process.argv.slice(2)]);
process.exit(tests.status ?? 1);
