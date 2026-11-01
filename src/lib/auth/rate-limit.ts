import { bucketKey } from "./client-ip";

/**
 * Durable rate limiting for the account endpoints. The counters live in Postgres (`rate_limit_hit`), so every serverless instance
 * shares them, and each hit is one atomic upsert, so concurrent requests cannot both slip under a limit.
 *
 * Fail CLOSED: if the counter store cannot be reached, the request is refused (503), never waved through.
 */
export type LimitRule = { name: string; limit: number; windowSeconds: number };

export interface RateLimitStore {
  hit(key: Buffer, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }>;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfter: number; rule: string };

/** What each endpoint allows. Per client address unless stated; the numbers are deliberately tight for an invite-only beta. */
export const LIMITS = {
  join: [
    { name: "join:ip:10m", limit: 8, windowSeconds: 600 },
    { name: "join:ip:day", limit: 60, windowSeconds: 86_400 },
  ],
  /** One shared budget for everybody: an emergency brake on distributed guessing. */
  joinGlobal: [{ name: "join:global:hour", limit: 600, windowSeconds: 3_600 }],
  signin: [{ name: "signin:ip:10m", limit: 20, windowSeconds: 600 }],
  callback: [{ name: "callback:ip:10m", limit: 30, windowSeconds: 600 }],
  admin: [{ name: "admin:user:min", limit: 30, windowSeconds: 60 }],
} satisfies Record<string, LimitRule[]>;

/** Checks every rule (all are counted, so a refused request still uses budget) and reports the strictest refusal. */
export async function checkLimits(store: RateLimitStore, secret: Buffer, rules: LimitRule[], subject: string): Promise<LimitDecision> {
  let worst: LimitDecision = { allowed: true };
  for (const rule of rules) {
    const r = await store.hit(bucketKey(secret, rule.name, subject), rule.limit, rule.windowSeconds);
    if (!r.allowed && (worst.allowed || r.retryAfter > worst.retryAfter)) worst = { allowed: false, retryAfter: r.retryAfter, rule: rule.name };
  }
  return worst;
}
