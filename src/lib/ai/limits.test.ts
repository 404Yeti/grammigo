import { describe, expect, it } from "vitest";
import { aiAvailability, readAiConfig } from "./config";

// Measured upload sizes for a full 30 s recording at the recorder's 32 kbps (see VoiceRecorder).
const MEASURED_30S_BYTES = { chromium: 121_563, firefox: 136_477 };

describe("audio upload limit matches the intended 30-second recording", () => {
  const { audioBytesMax } = readAiConfig({}).limits;

  it("accepts a full 30 s recording from every measured browser with headroom", () => {
    for (const bytes of Object.values(MEASURED_30S_BYTES)) expect(audioBytesMax).toBeGreaterThan(bytes * 1.5);
  });

  it("does not allow a multi-minute upload (cost control: ≤ ~90 s at 32 kbps)", () => {
    const secondsAt32kbps = (audioBytesMax * 8) / 32_000;
    expect(secondsAt32kbps).toBeLessThanOrEqual(90);
  });
});

describe("durable limiter configuration", () => {
  it("accepts the documented UPSTASH_REDIS_REST_* names", () => {
    const c = readAiConfig({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(c.durableLimiter).toEqual({ url: "https://x", token: "t" });
  });

  it("accepts the KV_REST_API_* names Vercel's Upstash integration injects", () => {
    const c = readAiConfig({ KV_REST_API_URL: "https://y", KV_REST_API_TOKEN: "k" });
    expect(c.durableLimiter).toEqual({ url: "https://y", token: "k" });
  });

  it("never falls back to the read-only token, and needs both halves", () => {
    expect(readAiConfig({ KV_REST_API_URL: "https://y", KV_REST_API_READ_ONLY_TOKEN: "ro" }).durableLimiter).toBeNull();
    expect(readAiConfig({ KV_REST_API_URL: "https://y" }).durableLimiter).toBeNull();
  });
});

describe("production availability with Vercel's injected Upstash names", () => {
  const prod = { NODE_ENV: "production", AI_FEATURES_ENABLED: "true", OPENAI_API_KEY: "placeholder", AI_DAILY_CALL_CAP: "150" };

  it("is available only with the flag, a key AND durable limiting", () => {
    const withKv = readAiConfig({ ...prod, KV_REST_API_URL: "https://y", KV_REST_API_TOKEN: "k" });
    expect(aiAvailability(withKv)).toEqual({ available: true });
    expect(withKv.dailyCallCap).toBe(150);
  });

  it("fails closed in production without Upstash, without a key, or with the flag off", () => {
    expect(aiAvailability(readAiConfig(prod))).toEqual({ available: false, reason: "not_configured" });
    expect(aiAvailability(readAiConfig({ ...prod, OPENAI_API_KEY: "", KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" })).available).toBe(false);
    expect(aiAvailability(readAiConfig({ ...prod, AI_FEATURES_ENABLED: "false", KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" }))).toEqual({ available: false, reason: "disabled" });
  });
});
