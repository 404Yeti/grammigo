// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RESERVE_SYNTHESIS } from "./budgets";

// Opt-in only. Uses isolated expiring keys in existing storage; never synthesizes audio.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
describe.skipIf(process.env.TTS_QUOTA_LIVE !== "1" || !url || !token)("atomic synthesis quotas in live Redis", () => {
  it("admits only bounded attempts, keeps denied reservations free, handles UTC-period keys and never partially mutates corrupt counters", async () => {
    const prefix = `grammigo:test:fai53:${randomUUID()}`;
    const keys = [prefix + ":shared", prefix + ":primary", prefix + ":credits"];
    const nextDay = [prefix + ":next-day", prefix + ":next-primary", keys[2]];
    const nextMonth = [prefix + ":month-day", prefix + ":month-primary", prefix + ":next-month"];
    const allKeys = [...new Set([...keys, ...nextDay, ...nextMonth])];
    const expiry = String(Math.floor(Date.now() / 1000) + 180);
    const command = async (body: string[]): Promise<unknown> => {
      const response = await fetch(url!, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Redis test unavailable");
      const value = await response.json() as { result?: unknown; error?: unknown };
      if (value.error) throw new Error("Redis rejected test command");
      return value.result;
    };
    const reserve = (provider: string, amount = 17, shared = 8, primary = 5, credits = 100, periodKeys = keys) =>
      command(["EVAL", RESERVE_SYNTHESIS, "3", ...periodKeys, String(shared), String(primary), String(credits), provider === "elevenlabs" ? "1" : "0", String(amount), expiry, expiry]);
    const counts = async () => (await Promise.all(keys.map(key => command(["GET", key])))).map(Number);
    try {
      const primary = await Promise.all(Array.from({ length: 30 }, () => reserve("elevenlabs", 17, 8, 30, 100)));
      expect(primary.filter(result => result === 0)).toHaveLength(5);
      expect(await counts()).toEqual([5, 5, 85]);
      expect(await reserve("elevenlabs", 15, 8, 6, 100)).toBe(0);
      expect(await counts()).toEqual([6, 6, 100]);
      const denied = await Promise.all(Array.from({ length: 20 }, () => reserve("elevenlabs", 1, 8, 6, 100)));
      expect(denied.every(result => result === 2)).toBe(true);
      expect(await counts()).toEqual([6, 6, 100]);
      const coral = await Promise.all(Array.from({ length: 20 }, () => reserve("coral")));
      expect(coral.filter(result => result === 0)).toHaveLength(2);
      expect(await counts()).toEqual([8, 6, 100]);
      expect(await reserve("elevenlabs", 1, 8, 6, 100, nextDay)).toBe(3);
      expect(await command(["GET", nextDay[0]])).toBeNull();
      expect(await reserve("coral", 1, 8, 6, 100, nextDay)).toBe(0);
      expect(await reserve("elevenlabs", 17, 8, 6, 100, nextMonth)).toBe(0);
      expect(await command(["GET", nextMonth[2]])).toBe("17");
      // Redis does not roll back preceding writes if a script raises an error.
      await command(["SET", keys[2], "not-a-number", "EX", "180"]);
      await expect(reserve("elevenlabs", 1, 10, 10, 100)).rejects.toThrow();
      expect((await counts()).slice(0, 2)).toEqual([8, 6]);
      expect(await command(["GET", nextDay[1]])).toBeNull();
      const ttls = await Promise.all(allKeys.filter(key => key !== nextDay[1]).map(key => command(["TTL", key])));
      expect(ttls.every(ttl => typeof ttl === "number" && ttl > 0 && ttl <= 180)).toBe(true);
    } finally {
      await Promise.all(allKeys.map(key => command(["EXPIRE", key, "60"])));
    }
  }, 60_000);
});
