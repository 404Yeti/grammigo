// @vitest-environment node
import { expect, it, vi } from "vitest";
import { defaultSpeechDeps } from "./server";
import { readAiConfig } from "@/lib/ai/config";
import { synthesisBudget, monthlyCreditLimit, RESERVE_SYNTHESIS, synthesisLimit } from "./budgets";

it("uses configurable integer limits, beta defaults, explicit zero, and bounded maxima", () => {
  for (const raw of [undefined, "", " ", "bad", "Infinity", "-1", "1.5"]) expect(synthesisLimit(raw)).toBe(300);
  expect(synthesisLimit("50")).toBe(50);
  expect(synthesisLimit("0")).toBe(0);
  expect(synthesisLimit("100000")).toBe(1000);
  expect(monthlyCreditLimit(undefined)).toBe(100_000);
  expect(monthlyCreditLimit("5000")).toBe(5000);
  expect(monthlyCreditLimit("0")).toBe(0);
  for (const raw of ["bad", "-2", "0.5", "Infinity", "10000001"]) expect(monthlyCreditLimit(raw)).toBe(100_000);
});
const config = readAiConfig({ NODE_ENV: "production", KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "private-test-token" });
const local = readAiConfig({ NODE_ENV: "test" });
const caps = { shared: 3, primary: 2, credits: 100 };
const now = Date.parse("2026-11-30T23:59:59Z");

it("submits all applicable quotas as one atomic script with stable UTC keys and fixed expirations", async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const args = JSON.parse(init!.body as string);
    expect(args.slice(0, 3)).toEqual(["EVAL", RESERVE_SYNTHESIS, "3"]);
    expect(args.slice(3, 6)).toEqual([
      `grammigo:rl:tts:budget:2026-11-30:${Math.floor(now / 86_400_000)}`,
      `grammigo:rl:tts:elevenlabs:budget:2026-11-30:${Math.floor(now / 86_400_000)}`,
      "grammigo:tts:elevenlabs:credits:2026-11",
    ]);
    expect(args.slice(6)).toEqual(["3", "2", "100", "1", "30", String(Date.parse("2026-12-01T00:00:05Z") / 1000), String(Date.parse("2026-12-01T00:00:05Z") / 1000)]);
    return Response.json({ result: 0 });
  });
  expect(await synthesisBudget(config, caps, {}, fetcher).reserve("elevenlabs", 30, now)).toBeNull();
});

it("denies without consuming any allowance, so a valid smaller request and Coral can still run", async () => {
  const scope = {};
  const budget = synthesisBudget(local, { shared: 2, primary: 1, credits: 10 }, scope);
  for (let index = 0; index < 20; index++) expect(await budget.reserve("elevenlabs", 11, now)).toBe("elevenlabs_monthly_credit_budget");
  expect(await budget.reserve("elevenlabs", 10, now)).toBeNull();
  for (let index = 0; index < 20; index++) expect(await budget.reserve("elevenlabs", 1, now)).toBe("elevenlabs_daily_cap");
  expect(await budget.reserve("coral", 1, now)).toBeNull();
  expect(await budget.reserve("coral", 1, now)).toBe("shared_daily_cap");
  // Increasing caps reveals that rejected checks did not inflate stored usage.
  expect(await synthesisBudget(local, { shared: 3, primary: 2, credits: 11 }, scope).reserve("elevenlabs", 1, now)).toBeNull();
});

it("shares concurrent quotas across independent budget objects and never over-admits", async () => {
  const scope = {};
  const outcomes = await Promise.all(Array.from({ length: 40 }, () => synthesisBudget(local, caps, scope).reserve("elevenlabs", 30, now)));
  expect(outcomes.filter(reason => reason === null)).toHaveLength(2);
  expect(await synthesisBudget(local, caps, scope).reserve("coral", 1, now)).toBeNull();
  expect(await synthesisBudget(local, caps, scope).reserve("coral", 1, now)).toBe("shared_daily_cap");
});

it("resets daily quotas at UTC midnight while preserving monthly usage, then resets the month", async () => {
  const budget = synthesisBudget(local, { shared: 1, primary: 1, credits: 10 }, {});
  expect(await budget.reserve("elevenlabs", 6, Date.parse("2026-11-29T23:59:59Z"))).toBeNull();
  expect(await budget.reserve("elevenlabs", 4, Date.parse("2026-11-29T23:59:59Z"))).toBe("shared_daily_cap");
  expect(await budget.reserve("elevenlabs", 4, Date.parse("2026-11-30T00:00:00Z"))).toBeNull();
  expect(await budget.reserve("elevenlabs", 10, Date.parse("2026-12-01T00:00:00Z"))).toBeNull();
  expect(await budget.reserve("elevenlabs", 1, Date.parse("2026-12-02T00:00:00Z"))).toBe("elevenlabs_monthly_credit_budget");
  expect(await budget.reserve("coral", 1, Date.parse("2026-12-02T00:00:00Z"))).toBeNull();
});

it("fails closed on missing durable storage, malformed results, invalid caps and network errors", async () => {
  await expect(synthesisBudget(readAiConfig({ NODE_ENV: "production" }), caps).reserve("elevenlabs", 1, now)).rejects.toThrow();
  for (const response of [new Response("error", { status: 503 }), Response.json({ error: "private redis error" }), Response.json({ result: null }), Response.json({ result: 4 })]) {
    await expect(synthesisBudget(config, caps, {}, vi.fn(async () => response)).reserve("elevenlabs", 1, now)).rejects.toThrow("synthesis_budget_unavailable");
  }
  expect(() => synthesisBudget(config, { ...caps, credits: NaN })).toThrow();
  await expect(synthesisBudget(config, caps, {}, vi.fn(async () => { throw new Error("network"); })).reserve("elevenlabs", 1, now)).rejects.toThrow();
});

it("wires server-only overrides into both daily synthesis ceilings and the monthly budget", () => {
  vi.stubEnv("TTS_DAILY_CALL_CAP", "300"); vi.stubEnv("ELEVENLABS_DAILY_CALL_CAP", "300"); vi.stubEnv("ELEVENLABS_MONTHLY_CREDIT_BUDGET", "100000");
  vi.stubEnv("ELEVENLABS_API_KEY", "mock-server-key");
  try {
    expect(defaultSpeechDeps().dailyCap).toBe(300);
    expect(defaultSpeechDeps().primary?.dailyCap).toBe(300);
    expect(defaultSpeechDeps().monthlyCredits).toBe(100000);
    vi.stubEnv("TTS_DAILY_CALL_CAP", "50"); vi.stubEnv("ELEVENLABS_DAILY_CALL_CAP", "0");
    expect(defaultSpeechDeps().dailyCap).toBe(50); expect(defaultSpeechDeps().primary?.dailyCap).toBe(0);
  } finally { vi.unstubAllEnvs(); }
});
