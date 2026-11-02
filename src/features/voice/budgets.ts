import "server-only";
import type { AiConfig } from "@/lib/ai/config";

/** Invalid values retain the beta defaults; zero explicitly disables paid synthesis. */
export function synthesisLimit(raw: string | undefined, fallback = 300): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000) : fallback;
}

export function monthlyCreditLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 100_000;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : 100_000;
}

export interface CreditBudget { reserve(credits: number, now: number): Promise<boolean> }

// A reservation is atomic across Vercel instances. Denials do not consume the remaining budget.
// Never refund failed/timeout requests: the provider might already have billed them.
export const RESERVE_CREDITS = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
if used + amount > cap then return 0 end
redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIREAT', KEYS[1], ARGV[3])
return 1`;

const localCredits = new Map<string, number>();

export function creditBudget(config: AiConfig, cap: number, fetchImpl: typeof fetch = fetch): CreditBudget {
  const local = localCredits;
  return {
    async reserve(credits, now) {
      if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("credit_budget_unavailable");
      const date = new Date(now);
      const month = date.toISOString().slice(0, 7);
      const expires = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 2) / 1000);
      if (!config.durableLimiter) {
        if (config.production) throw new Error("credit_budget_unavailable");
        const used = local.get(month) ?? 0;
        if (used + credits > cap) return false;
        local.clear(); local.set(month, used + credits);
        return true;
      }
      const { url, token } = config.durableLimiter;
      const response = await fetchImpl(url.replace(/\/$/, ""), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", RESERVE_CREDITS, "1", `grammigo:tts:elevenlabs:credits:${month}`, String(credits), String(cap), String(expires)]),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error("credit_budget_unavailable");
      const result = await response.json() as { result?: unknown; error?: unknown };
      if (result.error || (result.result !== 0 && result.result !== 1)) throw new Error("credit_budget_unavailable");
      return result.result === 1;
    },
  };
}
