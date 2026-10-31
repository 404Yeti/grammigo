import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitStore } from "./rate-limit";

/**
 * The only place the service role is used for account work. Each method is one narrow, named operation (usually one database
 * function that is itself transactional), so the privileged surface is small and testable.
 */
export type RedeemResult = "ok" | "invalid" | "expired" | "revoked" | "already_registered";
export type ReserveResult = { grantId: string } | { error: "invalid" | "revoked" | "expired" | "full" };
export type ProfileState = "active" | "suspended" | "none";

export interface AccountDb {
  reserve(codeHash: Buffer): Promise<ReserveResult>;
  redeem(args: { grantId: string; userId: string; displayName: string; adultConfirmedAt: string; noticeVersion: string }): Promise<RedeemResult>;
  release(grantId: string): Promise<void>;
  profileState(userId: string): Promise<ProfileState>;
  purgeOrphan(userId: string): Promise<boolean>;
  limiter: RateLimitStore;
}

const hex = (b: Buffer) => `\\x${b.toString("hex")}`; // PostgREST's bytea input format

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what} failed`); // the message is not forwarded: it can name internals
  return r.data;
}

export function accountDb(client: SupabaseClient): AccountDb {
  return {
    async reserve(codeHash) {
      const rows = must(await client.rpc("reserve_invitation", { p_code_hash: hex(codeHash) }), "reserve") as { grant_id: string | null; error: string | null }[];
      const row = rows?.[0];
      if (!row) throw new Error("reserve returned nothing");
      if (row.grant_id) return { grantId: row.grant_id };
      const e = row.error;
      return { error: e === "revoked" || e === "expired" || e === "full" ? e : "invalid" };
    },
    async redeem(a) {
      const r = must(
        await client.rpc("redeem_invitation", { p_grant: a.grantId, p_user: a.userId, p_display_name: a.displayName, p_adult_confirmed_at: a.adultConfirmedAt, p_notice_version: a.noticeVersion }),
        "redeem",
      ) as string;
      return r === "ok" || r === "expired" || r === "revoked" || r === "already_registered" ? r : "invalid";
    },
    async release(grantId) {
      must(await client.rpc("release_reservation", { p_grant: grantId }), "release");
    },
    async profileState(userId) {
      const row = must(await client.from("profiles").select("status").eq("id", userId).maybeSingle(), "profile lookup") as { status: string } | null;
      return !row ? "none" : row.status === "active" ? "active" : "suspended";
    },
    async purgeOrphan(userId) {
      return must(await client.rpc("purge_orphan_identity", { p_user: userId }), "purge") as boolean;
    },
    limiter: {
      async hit(key, limit, windowSeconds) {
        const rows = must(await client.rpc("rate_limit_hit", { p_key: hex(key), p_limit: limit, p_window: `${windowSeconds} seconds` }), "rate limit") as { allowed: boolean; retry_after: number }[];
        const row = rows?.[0];
        if (!row) throw new Error("rate limit returned nothing");
        return { allowed: row.allowed, retryAfter: row.retry_after };
      },
    },
  };
}
