// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAiConfig } from "@/lib/ai/config";
import { MemoryRateLimiter } from "@/lib/ai/rate-limit";
import { handleSpeech, MAX_AUDIO_BYTES, resetSpeechCache, type SpeechDeps } from "./server";
import { MAX_SPEECH_CHARACTERS, speechText } from "./content";

beforeEach(resetSpeechCache);
const input = { lessonId: "present-perfect-vs-past-simple", questionId: "q1", kind: "instruction" } as const;
const request = (value: unknown = input, origin = "https://grammigo.test") => {
  const body = JSON.stringify(value);
  return new Request("https://grammigo.test/api/ai/tts", { method: "POST", headers: { host: "grammigo.test", origin, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body });
};
function setup(): SpeechDeps & { generate: ReturnType<typeof vi.fn> } {
  return { config: readAiConfig({ AI_FEATURES_ENABLED: "true", OPENAI_API_KEY: "test-key", NODE_ENV: "test" }), enabled: true, dailyCap: 50, limiter: new MemoryRateLimiter(), generate: vi.fn(async () => new Uint8Array([1, 2, 3])), now: () => Date.parse("2026-11-02T00:00:00Z") };
}

describe("bounded authored speech", () => {
  it("never calls the provider when the flag is off, AI is unavailable, or the documented model shutdown has arrived", async () => {
    const deps = setup();
    expect((await handleSpeech(request(), { ...deps, enabled: false })).status).toBe(503);
    expect((await handleSpeech(request(), { ...deps, config: readAiConfig({}) })).status).toBe(503);
    expect((await handleSpeech(request(), { ...deps, now: () => Date.parse("2027-01-06") })).status).toBe(503);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests, arbitrary text, unknown content, and oversized bodies before synthesis", async () => {
    const deps = setup();
    expect((await handleSpeech(request(input, "https://attacker.test"), deps)).status).toBe(403);
    expect((await handleSpeech(request({ ...input, text: "private learner answer" }), deps)).status).toBe(400);
    expect((await handleSpeech(request({ ...input, questionId: "unknown" }), deps)).status).toBe(400);
    expect((await handleSpeech(request({ ...input, text: "x".repeat(1000) }), deps)).status).toBe(413);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it("coalesces concurrent public prompt requests and reuses bounded audio without new paid calls", async () => {
    const deps = setup();
    const [a, b] = await Promise.all([handleSpeech(request(), deps), handleSpeech(request(), deps)]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("audio/mpeg");
    expect(a.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await handleSpeech(request(), deps)).status).toBe(200);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.generate.mock.calls[0][0]).toBe(speechText(input));
  });
  it("enforces an independent durable paid-call cap and fails closed when the limiter fails", async () => {
    const deps = setup();
    deps.dailyCap = 1;
    expect((await handleSpeech(request(), deps)).status).toBe(200);
    expect((await handleSpeech(request({ ...input, kind: "encouragement" }), deps)).status).toBe(503);
    expect(deps.generate).toHaveBeenCalledOnce();
    const failing = { hit: vi.fn().mockRejectedValue(new Error("unavailable")) };
    expect((await handleSpeech(request(), { ...setup(), limiter: failing })).status).toBe(503);
  });
  it("counts TTS separately from transcription and bounds provider output", async () => {
    const deps = setup();
    deps.config.limits.perMinute.tts = 1;
    expect((await handleSpeech(request(), deps)).status).toBe(200);
    expect((await handleSpeech(request(), deps)).status).toBe(429);
    const invalid = setup(); invalid.generate.mockResolvedValue(new Uint8Array(MAX_AUDIO_BYTES + 1)); resetSpeechCache();
    expect((await handleSpeech(request(), invalid)).status).toBe(503);
  });
  it("caps every authored speech variant and never takes a caller-supplied correction", () => {
    for (const kind of ["instruction", "encouragement", "correction", "hint"] as const) {
      const text = speechText({ ...input, kind });
      expect(text?.length).toBeGreaterThan(0);
      expect(text!.length).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
    }
  });
});
