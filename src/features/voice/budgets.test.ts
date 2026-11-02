// @vitest-environment node
import { expect, it, vi } from "vitest";
import { defaultSpeechDeps } from "./server";
import { readAiConfig } from "@/lib/ai/config";
import { creditBudget, monthlyCreditLimit, RESERVE_CREDITS, synthesisLimit } from "./budgets";

it("uses configurable integer daily limits, beta defaults, explicit zero, and a bounded maximum", () => {
  for (const raw of [undefined, "", " ", "bad", "Infinity", "-1", "1.5"]) expect(synthesisLimit(raw)).toBe(300);
  expect(synthesisLimit("50")).toBe(50);
  expect(synthesisLimit("300")).toBe(300);
  expect(synthesisLimit("0")).toBe(0);
  expect(synthesisLimit("100000")).toBe(1000);
  expect(monthlyCreditLimit(undefined)).toBe(100_000);
  expect(monthlyCreditLimit("5000")).toBe(5000);
  expect(monthlyCreditLimit("0")).toBe(0);
  for (const raw of ["bad", "-2", "0.5", "Infinity", "10000001"]) expect(monthlyCreditLimit(raw)).toBe(100_000);
});
const config = readAiConfig({ NODE_ENV: "production", KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "private-test-token" });
it("reserves credit amounts with one atomic Redis script and stable UTC month keys across instances", async () => {
  let used = 0;
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const [command, script, count, key, amount, cap, expires] = JSON.parse(init!.body as string);
    expect([command, script, count, key]).toEqual(["EVAL", RESERVE_CREDITS, "1", "grammigo:tts:elevenlabs:credits:2026-11"]);
    expect(Number(expires)).toBe(Date.parse("2026-12-02") / 1000);
    // Simulate Redis executing each script indivisibly; each caller uses an independent budget object.
    const allowed = used + Number(amount) <= Number(cap);
    if (allowed) used += Number(amount);
    return Response.json({ result: allowed ? 1 : 0 });
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => creditBudget(config, 100, fetcher).reserve(30, Date.parse("2026-11-30T23:59:59Z"))));
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(used).toBe(90);
  expect(await creditBudget(config, 100, fetcher).reserve(10, Date.parse("2026-11-01"))).toBe(true);
});
it("changes the UTC month key at rollover, rather than a moving fixed-window bucket", async () => {
  const fetcher = vi.fn(async () => Response.json({ result: 1 }));
  const budget = creditBudget(config, 100, fetcher);
  await budget.reserve(5, Date.parse("2026-11-30T23:59:59Z"));
  await budget.reserve(5, Date.parse("2026-12-01T00:00:00Z"));
  const keys = fetcher.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string)[3]);
  expect(keys).toEqual(["grammigo:tts:elevenlabs:credits:2026-11", "grammigo:tts:elevenlabs:credits:2026-12"]);
});
it("fails closed on missing durable storage, network errors and malformed Redis responses", async () => {
  await expect(creditBudget(readAiConfig({ NODE_ENV: "production" }), 100).reserve(1, Date.now())).rejects.toThrow("credit_budget_unavailable");
  for (const response of [new Response("error", { status: 503 }), Response.json({ error: "private redis error" }), Response.json({ result: null })]) {
    await expect(creditBudget(config, 100, vi.fn(async () => response)).reserve(1, Date.now())).rejects.toThrow("credit_budget_unavailable");
  }
  await expect(creditBudget(config, 100, vi.fn(async () => { throw new Error("network"); })).reserve(1, Date.now())).rejects.toThrow();
});

it("wires server-only overrides into both synthesis ceilings", () => {
  vi.stubEnv("TTS_DAILY_CALL_CAP", "300");
  vi.stubEnv("ELEVENLABS_DAILY_CALL_CAP", "300");
  vi.stubEnv("ELEVENLABS_API_KEY", "mock-server-key");
  try {
    expect(defaultSpeechDeps().dailyCap).toBe(300);
    expect(defaultSpeechDeps().primary?.dailyCap).toBe(300);
    vi.stubEnv("TTS_DAILY_CALL_CAP", "50");
    vi.stubEnv("ELEVENLABS_DAILY_CALL_CAP", "0");
    expect(defaultSpeechDeps().dailyCap).toBe(50);
    expect(defaultSpeechDeps().primary?.dailyCap).toBe(0);
  } finally { vi.unstubAllEnvs(); }
});
