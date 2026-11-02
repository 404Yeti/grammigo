import "server-only";
import { createHash } from "node:crypto";
import { createSpeechClient } from "@/features/ai/deps";
import { readAiConfig, type AiConfig } from "@/lib/ai/config";
import { guardRequest, json, limiterFor } from "@/lib/ai/guard";
import type { RateLimiter } from "@/lib/ai/rate-limit";
import { recordSpeechUsage } from "./usage";
import { speechRequestSchema, speechText } from "./content";

export const MAX_AUDIO_BYTES = 256_000;
const MODEL = "gpt-4o-mini-tts";
const VOICE = "coral";
const TIMEOUT_MS = 15_000;
const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();

export interface SpeechDeps {
  config: AiConfig;
  enabled: boolean;
  dailyCap: number;
  limiter: RateLimiter;
  generate: (text: string) => Promise<Uint8Array>;
  now?: () => number;
}
export function defaultSpeechDeps(): SpeechDeps {
  const config = readAiConfig();
  return {
    config, enabled: process.env.MIGO_VOICE_ENABLED === "true",
    dailyCap: Math.min(100, Math.max(1, Number(process.env.TTS_DAILY_CALL_CAP) || 50)),
    limiter: limiterFor(config),
    generate: async (input) => {
      const response = await createSpeechClient().create({
        model: MODEL, voice: VOICE, input, response_format: "mp3", speed: 0.95,
        instructions: "Read the supplied English grammar coaching text exactly. Speak warmly and clearly at a steady pace. Do not add words or sound effects.",
      }, { timeout: TIMEOUT_MS, maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("missing_audio");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error("audio_too_large"); }
          parts.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return bytes;
    },
  };
}
export function resetSpeechCache() { cache.clear(); pending.clear(); }

export async function handleSpeech(request: Request, deps: SpeechDeps): Promise<Response> {
  // Official shutdown date checked 2026-11-02. Fail gracefully instead of repeatedly calling a retired model.
  if (!deps.enabled || (deps.now?.() ?? Date.now()) >= Date.parse("2027-01-06T00:00:00Z")) return json(503, { error: "voice_unavailable" });
  const guarded = await guardRequest(request, "tts", deps.config, deps.limiter, 600);
  if (!guarded.ok) return guarded.response;
  let raw: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 600) return json(413, { error: "too_large" });
    raw = JSON.parse(body);
  } catch { return json(400, { error: "invalid_request" }); }
  const parsed = speechRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const text = speechText(parsed.data);
  if (!text) return json(400, { error: "invalid_request" });
  const key = createHash("sha256").update(`${MODEL}:${VOICE}:${text}`).digest("hex");
  let audio = cache.get(key);
  if (audio) recordSpeechUsage({ cacheHit: true });
  try {
    if (!audio) {
      let task = pending.get(key);
      if (!task) {
        // Separate durable paid-call budget, in addition to the shared AI budget and TTS visitor counters.
        task = (async () => {
          const budget = await deps.limiter.hit(`tts:budget:${new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 10)}`, deps.dailyCap, 86_400);
          if (!budget.allowed) throw new Error("budget");
          const started = Date.now();
          let bytes: Uint8Array;
          try {
            bytes = await deps.generate(text);
            if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("invalid_audio");
            const counts = { characters: text.length, bytes: bytes.byteLength, ms: Date.now() - started };
            recordSpeechUsage(counts);
            if (deps.config.usageLog) console.info("[tts-usage]", JSON.stringify({ model: MODEL, voice: VOICE, ...counts }));
          } catch {
            recordSpeechUsage({ characters: text.length, ms: Date.now() - started, failed: true });
            throw new Error("speech_unavailable");
          }
          cache.set(key, bytes);
          while (cache.size > 24) cache.delete(cache.keys().next().value!);
          return bytes;
        })();
        pending.set(key, task);
      }
      try { audio = await task; } finally { pending.delete(key); }
    }
    // Public authored audio only. Avoid CDN caching the endpoint's request/rate-limit behavior.
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    // Never log source text, learner data, provider responses or credentials.
    return json(503, { error: "voice_unavailable" });
  }
}
