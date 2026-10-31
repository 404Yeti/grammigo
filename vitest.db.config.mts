import { defineConfig } from "vitest/config";

/**
 * Database tests. They run against a LOCAL Supabase stack only (npm run test:db). They FAIL, never skip, when the stack is
 * unavailable or the migrations are not applied (see supabase/tests/global-setup.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
    globalSetup: ["./supabase/tests/global-setup.ts"],
    fileParallelism: false, // files share one database; concurrency inside a test is explicit
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["default"],
  },
});
