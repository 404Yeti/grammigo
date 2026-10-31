import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(root, "src"), "server-only": path.resolve(root, "src/tests/server-only-stub.ts") } },
  test: {
    environment: "happy-dom",
    pool: "threads",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
