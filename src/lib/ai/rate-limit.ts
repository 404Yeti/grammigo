export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Counts one hit against `key` and reports whether it is within `limit` per `windowSec`. */
  hit(key: string, limit: number, windowSec: number): Promise<LimitResult>;
}

/**
 * Per-process sliding-window limiter. Fine for local development and tests. On serverless
 * platforms every instance has its own memory, so this is NOT sufficient protection for a public
 * deployment; production requires the durable limiter below (enforced by aiAvailability()).
 */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private now: () => number = Date.now,
    private maxKeys = 5000,
  ) {}

  async hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
    const now = this.now();
    const windowMs = windowSec * 1000;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      // Bound memory: drop the oldest-inserted keys.
      for (const k of this.hits.keys()) {
        this.hits.delete(k);
        if (this.hits.size <= this.maxKeys * 0.9) break;
      }
    }
    return { allowed: true, remaining: limit - recent.length, retryAfterSec: 0 };
  }
}

/** Durable fixed-window limiter over the Upstash Redis REST API (no extra dependency). */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private url: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const redisKey = `grammigo:rl:${key}:${bucket}`;
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(windowSec + 5)],
      ]),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`rate limiter unavailable (${res.status})`);
    const out = (await res.json()) as { result?: number }[];
    const count = Number(out?.[0]?.result);
    if (!Number.isFinite(count)) throw new Error("rate limiter returned an unexpected response");
    const resetIn = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
    return count > limit
      ? { allowed: false, remaining: 0, retryAfterSec: Math.max(1, resetIn) }
      : { allowed: true, remaining: limit - count, retryAfterSec: 0 };
  }
}
