import "server-only";
import { createHash } from "node:crypto";
import { readAiConfig, type AiConfig } from "@/lib/ai/config";
import { guardRequest, json, limiterFor } from "@/lib/ai/guard";
import type { RateLimiter } from "@/lib/ai/rate-limit";
import { recordSpeechUsage } from "./usage";
import { speechRequestSchema, speechText } from "./content";
import { CORAL_IDENTITY, elevenLabsProvider, generateCoral, MAX_AUDIO_BYTES, SpeechProviderError } from "./providers";
import { synthesisBudget, monthlyCreditLimit, synthesisLimit, type SynthesisBudget } from "./budgets";

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
  budget?: SynthesisBudget;
  monthlyCredits?: number;
  now?: () => number;
}
export function defaultSpeechDeps(): SpeechDeps {
  const config = readAiConfig();
  return {
    config, enabled: process.env.MIGO_VOICE_ENABLED === "true",
    dailyCap: synthesisLimit(process.env.TTS_DAILY_CALL_CAP),
    monthlyCredits: monthlyCreditLimit(process.env.ELEVENLABS_MONTHLY_CREDIT_BUDGET),
    limiter: limiterFor(config), generate: generateCoral, primary: elevenLabsProvider(),
  };
}
export function resetSpeechCache() { cache.clear(); pending.clear(); }

async function synthesize(text: string, deps: SpeechDeps): Promise<Clip> {
  const now = deps.now?.() ?? Date.now();
  const budget = deps.budget ?? synthesisBudget(deps.config, {
    shared: deps.dailyCap, primary: deps.primary?.dailyCap ?? 0, credits: deps.monthlyCredits ?? 100_000,
  }, deps.limiter);
  const diagnostic = (event: "fallback" | "unavailable" | "provider_failure", reason: string, provider?: "elevenlabs" | "coral", status?: number) => {
    console.info("[tts-diagnostic]", JSON.stringify({ event, reason, ...(provider ? { provider } : {}), ...(status ? { status } : {}) }));
  };
  const reserve = async (provider: "elevenlabs" | "coral") => {
    try { return await budget.reserve(provider, text.length, now); }
    catch { diagnostic("unavailable", "synthesis_budget_unavailable"); throw new Error("synthesis_budget_unavailable"); }
  };
  const attempt = async (generate: SpeechDeps["generate"], provider: "elevenlabs" | "coral") => {
    const started = Date.now();
    try {
      const bytes = await generate(text);
      if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("invalid_audio");
      const counts = { provider, characters: text.length, bytes: bytes.byteLength, ms: Date.now() - started };
      recordSpeechUsage(counts);
      if (deps.config.usageLog) console.info("[tts-usage]", JSON.stringify(counts));
      return bytes;
    } catch (error) {
      const reason = error instanceof SpeechProviderError ? error.reason : "provider_failure";
      diagnostic(provider === "elevenlabs" ? "fallback" : "provider_failure", reason, provider, error instanceof SpeechProviderError ? error.status : undefined);
      recordSpeechUsage({ provider, characters: text.length, ms: Date.now() - started, failed: true });
      return null;
    }
  };
  if (deps.primary) {
    const denial = await reserve("elevenlabs");
    if (denial === "shared_daily_cap") { diagnostic("unavailable", denial); throw new Error("budget"); }
    if (!denial) {
      const bytes = await attempt(deps.primary.generate, "elevenlabs");
      if (bytes) return { bytes, expires: now + 86_400_000 };
    } else diagnostic("fallback", denial, "elevenlabs");
  } else diagnostic("fallback", "elevenlabs_not_configured", "elevenlabs");
  if (now >= CORAL_SHUTDOWN) { diagnostic("unavailable", "coral_retired", "coral"); throw new Error("voice_unavailable"); }
  const denial = await reserve("coral");
  if (denial) { diagnostic("unavailable", denial, "coral"); throw new Error("budget"); }
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
