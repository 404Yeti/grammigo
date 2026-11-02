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
