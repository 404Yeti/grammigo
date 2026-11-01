import { createServer, type Socket } from "node:net";
import { q, resetRateLimits } from "./helpers";

/**
 * Counters persist between runs; every run starts with a clean budget.
 * Also starts a TCP black hole: it accepts connections and never answers, standing in for a Supabase that has hung. One server of the
 * accounts suite points at it (see playwright.accounts.config.ts).
 */
export default async function globalSetup() {
  await resetRateLimits();
  await q("select 1");
  const port = Number(process.env.E2E_BLACKHOLE_PORT ?? 9099);
  const sockets = new Set<Socket>();
  const hole = createServer((s) => {
    sockets.add(s);
    s.on("error", () => undefined);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => hole.once("error", reject).listen(port, "127.0.0.1", resolve));
  return async () => {
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((r) => hole.close(() => r()));
  };
}
