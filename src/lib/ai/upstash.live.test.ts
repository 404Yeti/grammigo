import { describe, expect, it } from "vitest";
import { UpstashRateLimiter } from "./rate-limit";

/**
 * LIVE check of the durable limiter against a real Upstash Redis. Skipped unless credentials are
 * in the environment, so normal test runs never touch the network:
 *
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npx vitest run src/lib/ai/upstash.live.test.ts
 *
 * It uses unique throwaway keys (expire in about a minute) and prints nothing secret.
 */
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!url || !token)("UpstashRateLimiter against a real Upstash instance", () => {
  const limiter = () => new UpstashRateLimiter(url!, token!);
  const unique = () => `live-test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  it("allows up to the limit, then refuses with a sensible Retry-After", async () => {
    const l = limiter();
    const key = unique();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await l.hit(key, 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[3].retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(results[3].retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("keeps different keys independent", async () => {
    const l = limiter();
    const a = unique();
    const b = unique();
    await l.hit(a, 1, 60);
    expect((await l.hit(a, 1, 60)).allowed).toBe(false);
    expect((await l.hit(b, 1, 60)).allowed).toBe(true);
  });

  it("is atomic under a concurrent burst: exactly `limit` of 12 parallel hits are allowed", async () => {
    const l = limiter();
    const key = unique();
    const burst = await Promise.all(Array.from({ length: 12 }, () => l.hit(key, 5, 60)));
    expect(burst.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("shares state across separate limiter instances (what serverless instances need)", async () => {
    const key = unique();
    await limiter().hit(key, 1, 60);
    expect((await limiter().hit(key, 1, 60)).allowed).toBe(false);
  });

  it("fails closed (throws) when the token is wrong, so the guard can answer 503", async () => {
    const bad = new UpstashRateLimiter(url!, "not-the-token");
    await expect(bad.hit(unique(), 1, 60)).rejects.toThrow();
  });
});
