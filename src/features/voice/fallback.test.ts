// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { readAiConfig } from "@/lib/ai/config";
import { MemoryRateLimiter } from "@/lib/ai/rate-limit";
import { handleSpeech, resetSpeechCache, type SpeechDeps } from "./server";

beforeEach(resetSpeechCache);
const request = () => new Request("https://grammigo.test/api/ai/tts", { method: "POST", headers: { host: "grammigo.test", origin: "https://grammigo.test", "content-length": "120" }, body: JSON.stringify({ lessonId: "present-perfect-vs-past-simple", questionId: "q1", kind: "instruction" }) });
function setup() {
  const coral = vi.fn(async () => new Uint8Array([2]));
  const primary = vi.fn(async () => new Uint8Array([1]));
  const deps: SpeechDeps = { enabled: true, config: readAiConfig({ AI_FEATURES_ENABLED: "true", OPENAI_API_KEY: "test", NODE_ENV: "test" }), dailyCap: 50, limiter: new MemoryRateLimiter(), generate: coral, primary: { identity: "custom-migo", dailyCap: 20, generate: primary }, now: () => Date.parse("2026-11-02") };
  return { deps, coral, primary };
}
it("prefers custom Migo, coalesces/cache-replays, and never calls Coral on success", async () => {
  const { deps, coral, primary } = setup();
  const [a, b] = await Promise.all([handleSpeech(request(), deps), handleSpeech(request(), deps)]);
  expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1]));
  expect(b.status).toBe(200);
  await handleSpeech(request(), deps);
  expect(primary).toHaveBeenCalledOnce(); expect(coral).not.toHaveBeenCalled();
});
it("reserves a SECOND shared paid slot for bounded Coral fallback; never bypasses the unchanged cap", async () => {
  const { deps, coral, primary } = setup(); primary.mockRejectedValue(new Error("upstream"));
  deps.dailyCap = 1;
  expect((await handleSpeech(request(), deps)).status).toBe(503);
  expect(coral).not.toHaveBeenCalled();
  resetSpeechCache();
  deps.limiter = new MemoryRateLimiter(); deps.dailyCap = 2;
  expect(new Uint8Array(await (await handleSpeech(request(), deps)).arrayBuffer())).toEqual(new Uint8Array([2]));
  expect(coral).toHaveBeenCalledOnce();
});
it("tries the custom voice again after the brief fallback cache expires", async () => {
  const { deps, primary, coral } = setup(); primary.mockRejectedValueOnce(new Error("timeout"));
  await handleSpeech(request(), deps); await handleSpeech(request(), deps);
  expect(primary).toHaveBeenCalledOnce(); expect(coral).toHaveBeenCalledOnce();
  deps.now = () => Date.parse("2026-11-02") + 60_001;
  const recovered = await handleSpeech(request(), deps);
  expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(new Uint8Array([1]));
  expect(primary).toHaveBeenCalledTimes(2); expect(coral).toHaveBeenCalledOnce();
});
it("falls back on the separate ElevenLabs quota, but fails closed on limiter outages", async () => {
  const { deps, primary, coral } = setup(); deps.primary!.dailyCap = 0;
  expect((await handleSpeech(request(), deps)).status).toBe(200);
  expect(primary).not.toHaveBeenCalled(); expect(coral).toHaveBeenCalledOnce();
  resetSpeechCache(); deps.limiter = { hit: async () => { throw new Error("unavailable"); } };
  expect((await handleSpeech(request(), deps)).status).toBe(503);
});
it("keeps ElevenLabs working after Coral shutdown and never falls back to a retired model", async () => {
  const { deps, primary, coral } = setup(); deps.now = () => Date.parse("2027-01-07");
  expect((await handleSpeech(request(), deps)).status).toBe(200);
  resetSpeechCache(); primary.mockRejectedValue(new Error("unavailable"));
  expect((await handleSpeech(request(), deps)).status).toBe(503);
  expect(coral).not.toHaveBeenCalled();
});

it("bounds concurrent distinct primary/fallback attempts with the shared daily cap", async () => {
  const { deps, primary, coral } = setup();
  deps.dailyCap = 3;
  deps.config.limits.perMinute.tts = 100;
  primary.mockRejectedValue(new Error("private upstream details"));
  const kinds = ["instruction", "encouragement", "correction", "hint", "positive", "supportive"];
  const responses = await Promise.all(kinds.map(kind => {
    const req = request();
    return handleSpeech(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ lessonId: "present-perfect-vs-past-simple", questionId: "q1", kind }) }), deps);
  }));
  expect(primary.mock.calls.length + coral.mock.calls.length).toBe(3);
  expect(responses.some(response => response.status === 503)).toBe(true);
});
it("bounds concurrent ElevenLabs calls independently while Coral uses only remaining shared slots", async () => {
  const { deps, primary, coral } = setup();
  deps.primary!.dailyCap = 1; deps.dailyCap = 3;
  const kinds = ["instruction", "positive", "supportive"];
  const responses = await Promise.all(kinds.map(kind => {
    const req = request();
    return handleSpeech(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ lessonId: "present-perfect-vs-past-simple", questionId: "q1", kind }) }), deps);
  }));
  expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
  expect(primary).toHaveBeenCalledOnce(); expect(coral).toHaveBeenCalledTimes(2);
});
it("reserves monthly credits by character count once per synthesis and caches fallback without exposing diagnostics", async () => {
  const { deps, primary, coral } = setup();
  const reserve = vi.fn<(credits: number, now: number) => Promise<boolean>>(async () => false); deps.credits = { reserve };
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await handleSpeech(request(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.has("x-tts-reason")).toBe(false);
    await handleSpeech(request(), deps);
    expect(reserve).toHaveBeenCalledOnce();
    expect(reserve.mock.calls[0][0]).toBeGreaterThan(1);
    expect(primary).not.toHaveBeenCalled(); expect(coral).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain("elevenlabs_monthly_credit_budget");
  } finally { log.mockRestore(); }
});
it("does not synthesize through a monthly budget outage or refund a possibly billed failed primary", async () => {
  const { deps, primary, coral } = setup();
  const reserve = vi.fn(async () => { throw new Error("private token or network"); }); deps.credits = { reserve };
  const response = await handleSpeech(request(), deps);
  expect(await response.json()).toEqual({ error: "voice_unavailable" });
  expect(primary).not.toHaveBeenCalled(); expect(coral).not.toHaveBeenCalled();
  resetSpeechCache();
  deps.credits = { reserve: vi.fn(async () => true) };
  primary.mockRejectedValue(new Error("private provider body"));
  expect((await handleSpeech(request(), deps)).status).toBe(200);
  expect(deps.credits.reserve).toHaveBeenCalledOnce();
});

it("logs safe fallback reasons even with usage logging off, never raw errors or authored copy", async () => {
  const { deps, primary } = setup();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    deps.primary!.dailyCap = 0;
    await handleSpeech(request(), deps);
    expect(JSON.stringify(log.mock.calls)).toContain("elevenlabs_daily_cap");
    resetSpeechCache(); deps.primary!.dailyCap = 20;
    primary.mockRejectedValue(new Error("secret token and personal data"));
    await handleSpeech(request(), deps);
    const entries = JSON.stringify(log.mock.calls);
    expect(entries).toContain("provider_failure");
    expect(entries).not.toContain("secret token");
    expect(entries).not.toContain("personal data");
    expect(entries).not.toContain("characters");
  } finally { log.mockRestore(); }
});
