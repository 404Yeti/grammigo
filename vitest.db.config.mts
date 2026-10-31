import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Database tests. They run against a LOCAL Supabase stack only (npm run test:db). They FAIL, never skip, when the stack is
 * unavailable or the migrations are not applied (see supabase/tests/global-setup.ts).
 */
export default defineConfig({
  // The app's server modules are imported by the integration tests; `@` and `server-only` resolve as they do in the unit tests.
  resolve: { alias: { "@": path.resolve(root, "src"), "server-only": path.resolve(root, "src/tests/server-only-stub.ts") } },
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
