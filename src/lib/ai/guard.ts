import { createHash } from "node:crypto";
import { aiAvailability, type AiConfig } from "./config";
import { MemoryRateLimiter, UpstashRateLimiter, type RateLimiter } from "./rate-limit";

export type AiKind = "goals" | "transcribe" | "writing";

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

let memoryLimiter: RateLimiter | null = null;

export function limiterFor(config: AiConfig): RateLimiter {
  if (config.durableLimiter) return new UpstashRateLimiter(config.durableLimiter.url, config.durableLimiter.token);
  return (memoryLimiter ??= new MemoryRateLimiter());
}

/** Test helper. */
export function resetMemoryLimiter(): void {
  memoryLimiter = null;
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Hash so raw addresses are never written to the limiter store.
  return createHash("sha256").update(forwarded).digest("hex").slice(0, 24);
}

/**
 * Same-origin only: these endpoints exist to serve the Grammigo UI, not other sites or scripts.
 * A request must carry an Origin matching the Host, or Sec-Fetch-Site: same-origin.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    try {
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export type GuardResult = { ok: true } | { ok: false; response: Response };

/**
 * Runs every abuse control before any model call: availability, same-origin, body size,
 * per-client per-minute and per-day limits, and a global daily call cap (budget).
 * Limiter failures fail closed. Nothing here logs request content.
 */
export async function guardRequest(
  req: Request,
  kind: AiKind,
  config: AiConfig,
  limiter: RateLimiter,
  maxBodyBytes: number,
): Promise<GuardResult> {
  const availability = aiAvailability(config);
  if (!availability.available) {
    return { ok: false, response: json(503, { error: "unavailable", reason: availability.reason }) };
  }
  if (!isSameOrigin(req)) return { ok: false, response: json(403, { error: "forbidden" }) };

  const length = Number(req.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(length)) return { ok: false, response: json(411, { error: "length_required" }) };
  if (length > maxBodyBytes) return { ok: false, response: json(413, { error: "too_large" }) };

  try {
    const key = clientKey(req);
    const minute = await limiter.hit(`${kind}:m:${key}`, config.limits.perMinute[kind], 60);
    if (!minute.allowed) {
      return { ok: false, response: json(429, { error: "rate_limited" }, { "Retry-After": String(minute.retryAfterSec) }) };
    }
    const day = await limiter.hit(`${kind}:d:${key}`, config.limits.perDay[kind], 86_400);
    if (!day.allowed) {
      return { ok: false, response: json(429, { error: "rate_limited" }, { "Retry-After": String(day.retryAfterSec) }) };
    }
    const budget = await limiter.hit(`budget:${new Date().toISOString().slice(0, 10)}`, config.dailyCallCap, 86_400);
    if (!budget.allowed) {
      return { ok: false, response: json(503, { error: "unavailable", reason: "budget" }) };
    }
  } catch {
    return { ok: false, response: json(503, { error: "unavailable", reason: "limiter" }) };
  }
  return { ok: true };
}
