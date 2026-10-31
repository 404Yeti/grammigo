import { describe, expect, it } from "vitest";
import { guardRequest } from "./guard";
import { readAiConfig } from "./config";
import { UpstashRateLimiter, type RateLimiter } from "./rate-limit";

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

  describe("through the real request guard (throwaway key prefix, never touches production counters)", () => {
    const prefixed = (run: string): RateLimiter => {
      const real = limiter();
      return { hit: (key, limit, windowSec) => real.hit(`${run}:${key}`, limit, windowSec) };
    };
    const req = () =>
      new Request("https://grammigo.example/api/ai/writing-feedback", {
        method: "POST",
        headers: { origin: "https://grammigo.example", host: "grammigo.example", "content-length": "100", "x-forwarded-for": "203.0.113.7" },
      });
    const config = (cap: string) =>
      readAiConfig({
        NODE_ENV: "production",
        AI_FEATURES_ENABLED: "true",
        OPENAI_API_KEY: "placeholder-not-used",
        UPSTASH_REDIS_REST_URL: url!,
        UPSTASH_REDIS_REST_TOKEN: token!,
        AI_DAILY_CALL_CAP: cap,
      });

    it("the global daily call cap stops everyone once it is spent (503 budget)", async () => {
      const limiterForRun = prefixed(unique());
      const cfg = config("3");
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        // vary the client so only the GLOBAL cap, not a per-client limit, can be what stops us
        const r = new Request("https://grammigo.example/api/ai/writing-feedback", {
          method: "POST",
          headers: { origin: "https://grammigo.example", host: "grammigo.example", "content-length": "100", "x-forwarded-for": `198.51.100.${i + 1}` },
        });
        const g = await guardRequest(r, "writing", cfg, limiterForRun, 10_000);
        statuses.push(g.ok ? 200 : g.response.status);
      }
      expect(statuses).toEqual([200, 200, 200, 503, 503]);
    });

    it("one client is stopped by its own per-minute limit (429) before the global cap", async () => {
      const limiterForRun = prefixed(unique());
      const cfg = config("1000");
      const perMinute = cfg.limits.perMinute.writing;
      const statuses: number[] = [];
      for (let i = 0; i < perMinute + 2; i++) {
        const g = await guardRequest(req(), "writing", cfg, limiterForRun, 10_000);
        statuses.push(g.ok ? 200 : g.response.status);
      }
      expect(statuses.slice(0, perMinute).every((s) => s === 200)).toBe(true);
      expect(statuses.slice(perMinute)).toEqual([429, 429]);
    });

    it("fails closed with 503 when Upstash is unreachable", async () => {
      const dead = new UpstashRateLimiter("https://127.0.0.1:1", "x");
      const g = await guardRequest(req(), "writing", config("10"), dead, 10_000);
      expect(g.ok).toBe(false);
      expect(!g.ok && g.response.status).toBe(503);
    });
  });
});
