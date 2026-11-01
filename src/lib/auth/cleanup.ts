import type { SupabaseClient } from "@supabase/supabase-js";
import { safeEqual } from "./flow";

/**
 * The scheduled sweep: it hands back abandoned seats, deletes Google identities that never got a profile, and prunes old rate-limit
 * counters. Each step is independent, so one failing does not stop the others, and every step is idempotent.
 *
 * Security does not depend on this job. An identity without a profile has no access whether or not it has been deleted yet.
 */
/** Longer than a seat's 24-hour hold, so a registration still waiting for its confirmation email is never swept. A profile-less identity has no access whatever its age. */
export const ORPHAN_AGE = "25 hours";

export type CleanupReport = { released: number | null; purged: number | null; pruned: number | null; failed: string[] };

export async function runCleanup(service: SupabaseClient): Promise<CleanupReport> {
  const report: CleanupReport = { released: null, purged: null, pruned: null, failed: [] };
  const step = async (name: string, run: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<number | null> => {
    try {
      const { data, error } = await run();
      if (error) throw new Error(name);
      return typeof data === "number" ? data : null;
    } catch {
      report.failed.push(name);
      return null;
    }
  };
  report.released = await step("release_expired_reservations", () => service.rpc("release_expired_reservations"));
  report.purged = await step("purge_orphan_identities", () => service.rpc("purge_orphan_identities", { p_older: ORPHAN_AGE }));
  report.pruned = await step("prune_rate_limits", () => service.rpc("prune_rate_limits"));
  return report;
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. With no secret configured the endpoint refuses everything. */
export function cronAuthorised(authorization: string | null, secret: string | null): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice(7), secret);
}
