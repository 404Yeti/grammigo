/**
 * Server-side AI configuration. Reads ONLY plain (non-NEXT_PUBLIC) environment variables, so the
 * key and every limit stay out of client bundles. Never import this from client components.
 *
 *   OPENAI_API_KEY        required to enable AI (server only)
 *   AI_FEATURES_ENABLED   must be exactly "true"; off by default
 *   OPENAI_MODEL          chat model for goals + writing feedback (default below)
 *   OPENAI_TRANSCRIBE_MODEL  speech-to-text model (default below)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   durable rate limiting + daily budget
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
  limits: {
    goalsTextMax: number;
    writingTextMax: number;
    audioBytesMax: number;
    transcriptMax: number;
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
    limits: {
      goalsTextMax: 600,
      writingTextMax: 600,
      audioBytesMax: 600_000,
      transcriptMax: 600,
      maxOutputTokens: { goals: 350, writing: 500 },
      timeoutMs: { goals: 12_000, writing: 15_000, transcribe: 20_000 },
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
