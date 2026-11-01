import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for ACCOUNTS. They need the local Supabase stack and an app built with NEXT_PUBLIC_ACCOUNTS=on, so they run through
 * `npm run test:e2e:accounts` (scripts/test-e2e-accounts.mjs), which builds, starts the stack's env and refuses to run without it.
 */
const PORT = Number(process.env.E2E_ACCOUNTS_PORT ?? 3100);
/** A second copy of the same app whose database is unreachable: a REAL outage (every Auth and database call fails), used to prove learning does not depend on it. */
const OUTAGE_PORT = Number(process.env.E2E_OUTAGE_PORT ?? 3101);

export default defineConfig({
  testDir: "./e2e-accounts",
  globalSetup: "./e2e-accounts/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/join`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...(process.env as Record<string, string>), NEXT_DIST_DIR: ".next-accounts" },
    },
    {
      command: `npx next start -p ${OUTAGE_PORT}`,
      url: `http://localhost:${OUTAGE_PORT}/join`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Same build, same code; only the address of the database is wrong (nothing listens on port 9).
      env: { ...(process.env as Record<string, string>), NEXT_DIST_DIR: ".next-accounts", SUPABASE_URL: "http://127.0.0.1:9", AUTH_SITE_URL: `http://localhost:${OUTAGE_PORT}` },
    },
  ],
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 }, browserName: "chromium" } },
  ],
});
