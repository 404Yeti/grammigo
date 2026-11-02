import "server-only";
import { createHash } from "node:crypto";
import { readAiConfig, type AiConfig } from "@/lib/ai/config";
import { guardRequest, json, limiterFor } from "@/lib/ai/guard";
import type { RateLimiter } from "@/lib/ai/rate-limit";
import { recordSpeechUsage } from "./usage";
import { speechRequestSchema, speechText } from "./content";
import { CORAL_IDENTITY, elevenLabsProvider, generateCoral, MAX_AUDIO_BYTES } from "./providers";

export { MAX_AUDIO_BYTES } from "./providers";
const CORAL_SHUTDOWN = Date.parse("2027-01-06T00:00:00Z");
interface Clip { bytes: Uint8Array; expires: number }
const cache = new Map<string, Clip>();
const pending = new Map<string, Promise<Clip>>();

export interface SpeechDeps {
  config: AiConfig;
  enabled: boolean;
  /** Existing shared paid-attempt cap: every primary AND fallback attempt reserves one slot. */
  dailyCap: number;
  limiter: RateLimiter;
  generate: (text: string) => Promise<Uint8Array>;
  primary?: { identity: string; dailyCap: number; generate: (text: string) => Promise<Uint8Array> };
  now?: () => number;
}
export function defaultSpeechDeps(): SpeechDeps {
  const config = readAiConfig();
  return {
    config, enabled: process.env.MIGO_VOICE_ENABLED === "true",
    dailyCap: Math.min(100, Math.max(1, Number(process.env.TTS_DAILY_CALL_CAP) || 50)),
    limiter: limiterFor(config), generate: generateCoral, primary: elevenLabsProvider(),
  };
}
export function resetSpeechCache() { cache.clear(); pending.clear(); }

async function synthesize(text: string, deps: SpeechDeps): Promise<Clip> {
  const now = deps.now?.() ?? Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const reserve = async () => {
    const budget = await deps.limiter.hit(`tts:budget:${day}`, deps.dailyCap, 86_400);
    if (!budget.allowed) throw new Error("budget");
  };
  const attempt = async (generate: SpeechDeps["generate"], provider: "elevenlabs" | "coral") => {
    await reserve(); // limiter errors fail closed, before a paid request
    const started = Date.now();
    try {
      const bytes = await generate(text);
      if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("invalid_audio");
      const counts = { provider, characters: text.length, bytes: bytes.byteLength, ms: Date.now() - started };
      recordSpeechUsage(counts);
      if (deps.config.usageLog) console.info("[tts-usage]", JSON.stringify(counts));
      return bytes;
    } catch {
      recordSpeechUsage({ provider, characters: text.length, ms: Date.now() - started, failed: true });
      return null;
    }
  };
  if (deps.primary) {
    // Separate provider budget: <=20 calls / <=6,400 authored characters daily by default.
    const budget = await deps.limiter.hit(`tts:elevenlabs:budget:${day}`, deps.primary.dailyCap, 86_400);
    if (budget.allowed) {
      const bytes = await attempt(deps.primary.generate, "elevenlabs");
      if (bytes) return { bytes, expires: now + 86_400_000 };
    }
  }
  if (now >= CORAL_SHUTDOWN) throw new Error("voice_unavailable");
  const bytes = await attempt(deps.generate, "coral");
  if (!bytes) throw new Error("voice_unavailable");
  // Recover the primary voice after a brief outage, rather than caching Coral indefinitely as Migo.
  return { bytes, expires: now + (deps.primary ? 60_000 : 86_400_000) };
}

export async function handleSpeech(request: Request, deps: SpeechDeps): Promise<Response> {
  if (!deps.enabled || (!deps.primary && (deps.now?.() ?? Date.now()) >= CORAL_SHUTDOWN)) return json(503, { error: "voice_unavailable" });
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
  const key = createHash("sha256").update(`${deps.primary?.identity ?? CORAL_IDENTITY}:${text}`).digest("hex");
  let clip = cache.get(key);
  if (clip && clip.expires <= (deps.now?.() ?? Date.now())) { cache.delete(key); clip = undefined; }
  if (clip) recordSpeechUsage({ cacheHit: true });
  try {
    if (!clip) {
      let task = pending.get(key);
      if (!task) {
        task = synthesize(text, deps).then(result => {
          cache.set(key, result);
          while (cache.size > 24) cache.delete(cache.keys().next().value!);
          return result;
        });
        pending.set(key, task);
      }
      try { clip = await task; } finally { pending.delete(key); }
    }
    return new Response(new Uint8Array(clip.bytes), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return json(503, { error: "voice_unavailable" }); // no provider errors, credentials or source text in logs
  }
}
