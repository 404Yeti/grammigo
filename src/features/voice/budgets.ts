import "server-only";
import type { AiConfig } from "@/lib/ai/config";

/** Invalid values retain beta defaults; zero explicitly disables the budget. */
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

export type SpeechProvider = "elevenlabs" | "coral";
export type BudgetDenial = "shared_daily_cap" | "elevenlabs_daily_cap" | "elevenlabs_monthly_credit_budget";
export interface SynthesisBudget {
  reserve(provider: SpeechProvider, credits: number, now: number): Promise<BudgetDenial | null>;
}
interface Caps { shared: number; primary: number; credits: number }
const reasons = [null, "shared_daily_cap", "elevenlabs_daily_cap", "elevenlabs_monthly_credit_budget"] as const;

// Check ALL applicable limits before changing ANY counter. Redis executes the script atomically.
// Keep dispatched attempts even after provider failure: timeout/error billing is uncertain and
// refunding attempts would permit unlimited paid retries. There are no automatic synthesis retries.
export const RESERVE_SYNTHESIS = `
local function counter(key)
  local value = tonumber(redis.call('GET', key) or '0')
  if not value or value < 0 or value % 1 ~= 0 then error('invalid_counter') end
  return value
end
local shared = counter(KEYS[1])
if shared >= tonumber(ARGV[1]) then return 1 end
if ARGV[4] == '1' then
  local primary = counter(KEYS[2])
  local credits = counter(KEYS[3])
  if primary >= tonumber(ARGV[2]) then return 2 end
  if credits + tonumber(ARGV[5]) > tonumber(ARGV[3]) then return 3 end
end
redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], ARGV[6])
if ARGV[4] == '1' then
  redis.call('INCR', KEYS[2])
  redis.call('EXPIREAT', KEYS[2], ARGV[6])
  redis.call('INCRBY', KEYS[3], ARGV[5])
  redis.call('EXPIREAT', KEYS[3], ARGV[7])
end
return 0`;

// Development/test budgets share a scope across requests, never across test limiter instances.
const memory = new WeakMap<object, Map<string, number>>();
const defaultScope = {};
export function synthesisBudget(config: AiConfig, caps: Caps, scope: object = defaultScope, fetchImpl: typeof fetch = fetch): SynthesisBudget {
  if (Object.values(caps).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("synthesis_budget_unavailable");
  return {
    async reserve(provider, credits, now) {
      if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("synthesis_budget_unavailable");
      const date = new Date(now);
      const day = date.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const bucket = Math.floor(now / 86_400_000);
      // Retain the existing production keys; deployments cannot reset already-consumed budgets.
      const keys = [`grammigo:rl:tts:budget:${day}:${bucket}`, `grammigo:rl:tts:elevenlabs:budget:${day}:${bucket}`, `grammigo:tts:elevenlabs:credits:${month}`];
      const dayExpiry = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) / 1000) + 5;
      const monthExpiry = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000) + 5;
      if (!config.durableLimiter) {
        if (config.production) throw new Error("synthesis_budget_unavailable");
        let counts = memory.get(scope);
        if (!counts) { counts = new Map(); memory.set(scope, counts); }
        const shared = counts.get(keys[0]) ?? 0, primary = counts.get(keys[1]) ?? 0, used = counts.get(keys[2]) ?? 0;
        if (shared >= caps.shared) return "shared_daily_cap";
        if (provider === "elevenlabs") {
          if (primary >= caps.primary) return "elevenlabs_daily_cap";
          if (used + credits > caps.credits) return "elevenlabs_monthly_credit_budget";
          counts.set(keys[1], primary + 1); counts.set(keys[2], used + credits);
        }
        counts.set(keys[0], shared + 1);
        for (const key of counts.keys()) if (!keys.includes(key)) counts.delete(key);
        return null;
      }
      const { url, token } = config.durableLimiter;
      const response = await fetchImpl(url.replace(/\/$/, ""), {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", RESERVE_SYNTHESIS, "3", ...keys, String(caps.shared), String(caps.primary), String(caps.credits), provider === "elevenlabs" ? "1" : "0", String(credits), String(dayExpiry), String(monthExpiry)]),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error("synthesis_budget_unavailable");
      const result = await response.json() as { result?: unknown; error?: unknown };
      if (result.error || typeof result.result !== "number" || !Number.isInteger(result.result) || result.result < 0 || result.result > 3) throw new Error("synthesis_budget_unavailable");
      return reasons[result.result];
    },
  };
}
