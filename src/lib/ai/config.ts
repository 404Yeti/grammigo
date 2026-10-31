/**
 * Server-side AI configuration. Reads ONLY plain (non-NEXT_PUBLIC) environment variables, so the
 * key and every limit stay out of client bundles. Never import this from client components.
 *
 *   OPENAI_API_KEY        required to enable AI (server only)
 *   AI_FEATURES_ENABLED   must be exactly "true"; off by default
 *   OPENAI_MODEL          chat model for goals + writing feedback (default below)
 *   OPENAI_TRANSCRIBE_MODEL  speech-to-text model (default below)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   durable rate limiting + daily budget
 *   AI_USAGE_LOG          "true" logs counts-only usage lines (tokens, seconds, est. cost; never content)
 *   OPENAI_PRICE_IN_PER_M / OPENAI_PRICE_OUT_PER_M / OPENAI_PRICE_TRANSCRIBE_PER_MIN  assumed USD prices
 *   AI_DAILY_CALL_CAP     hard cap on AI calls per UTC day across all users (default below)
 *   AI_ALLOW_MEMORY_LIMITER_IN_PRODUCTION   "true" to knowingly run production without Upstash
 */
export interface AiConfig {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  transcribeModel: string;
  production: boolean;
  durableLimiter: { url: string; token: string } | null;
  allowMemoryLimiterInProduction: boolean;
  dailyCallCap: number;
  /** Log one counts-only line per AI call (never content). */
  usageLog: boolean;
  prices: { inPerM: number; outPerM: number; transcribePerMin: number };
  limits: {
    goalsTextMax: number;
    writingTextMax: number;
    audioBytesMax: number;
    transcriptMax: number;
    /** Segments at or above this no-speech probability count as silence (initial value; tune from real usage logs). */
    noSpeechProb: number;
    maxOutputTokens: { goals: number; writing: number };
    timeoutMs: { goals: number; writing: number; transcribe: number };
    perMinute: { goals: number; transcribe: number; writing: number };
    perDay: { goals: number; transcribe: number; writing: number };
  };
}

export type AiEnv = Record<string, string | undefined>;

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function readAiConfig(env: AiEnv = process.env): AiConfig {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  return {
    enabled: env.AI_FEATURES_ENABLED === "true",
    apiKey: env.OPENAI_API_KEY?.trim() || null,
    // Cost-conscious defaults; both are overridable without a code change.
    model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1",
    production: env.NODE_ENV === "production",
    durableLimiter: url && token ? { url, token } : null,
    allowMemoryLimiterInProduction: env.AI_ALLOW_MEMORY_LIMITER_IN_PRODUCTION === "true",
    dailyCallCap: num(env.AI_DAILY_CALL_CAP, 300),
    usageLog: env.AI_USAGE_LOG === "true",
    // ASSUMED prices (USD). Override with the current numbers from OpenAI's pricing page.
    prices: {
      inPerM: num(env.OPENAI_PRICE_IN_PER_M, 0.15),
      outPerM: num(env.OPENAI_PRICE_OUT_PER_M, 0.6),
      transcribePerMin: num(env.OPENAI_PRICE_TRANSCRIBE_PER_MIN, 0.006),
    },
    limits: {
      goalsTextMax: 600,
      writingTextMax: 600,
      // Measured: a full 30 s recording at the recorder's 32 kbps is ~122 KB (Chromium) / ~136 KB
      // (Firefox). 300 KB leaves ~2x headroom (e.g. higher-bitrate Safari) and caps a request at
      // roughly 75 s of audio instead of ~150 s. Not yet measured on Safari/iOS.
      audioBytesMax: 300_000,
      transcriptMax: 600,
      noSpeechProb: 0.6,
      maxOutputTokens: { goals: 350, writing: 500 },
      // Real calls measured 1.4–4.2 s (goals) and ~1.5–2.2 s (writing); these leave ample headroom
      // without making a learner wait long when OpenAI is down.
      timeoutMs: { goals: 8_000, writing: 12_000, transcribe: 20_000 },
      perMinute: { goals: 6, transcribe: 4, writing: 6 },
      perDay: { goals: 40, transcribe: 20, writing: 40 },
    },
  };
}

export type AiAvailability =
  | { available: true }
  | { available: false; reason: "disabled" | "not_configured" };

/**
 * AI is available only when explicitly enabled AND a key exists AND (in production) a durable
 * rate limiter is configured. This is the "do not expose unprotected AI endpoints" rule in code.
 */
export function aiAvailability(config: AiConfig): AiAvailability {
  if (!config.enabled) return { available: false, reason: "disabled" };
  if (!config.apiKey) return { available: false, reason: "not_configured" };
  if (config.production && !config.durableLimiter && !config.allowMemoryLimiterInProduction) {
    return { available: false, reason: "not_configured" };
  }
  return { available: true };
}
