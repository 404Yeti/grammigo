import type { DocKey, RemoteDoc, SyncState } from "./documents";
import type { ApiResult, Failure, PutResult, SyncApi } from "./engine";

/**
 * The browser's connection to the sync routes. Every call has a time limit, so a slow or hung server can never leave a request hanging
 * for long, and every failure is turned into a plain reason the engine knows how to wait out. It never throws.
 */
const TIMEOUT_MS = 10_000;
const KEEPALIVE_LIMIT_BYTES = 60_000; // browsers cap keepalive bodies at 64 KB

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function failureFor(status: number, retryAfterHeader: string | null, error?: string): Failure {
  const retryAfter = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  if (status === 401) return { reason: "unauthorized" };
  if (status === 403) return { reason: error === "consent_required" ? "consent_required" : "unauthorized" };
  if (status === 413) return { reason: "too_large" };
  if (status === 422 || status === 400) return { reason: "invalid" };
  if (status === 429) return { reason: "rate_limited", retryAfter };
  if (status === 503 || status >= 500) return { reason: "unavailable", retryAfter };
  return { reason: "other" };
}

async function call(path: string, init: RequestInit & { keepalive?: boolean }): Promise<{ status: number; body: unknown; retryAfter: string | null; ms: number } | { failed: true; ms: number }> {
  const t0 = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal, cache: "no-store", credentials: "same-origin" });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, retryAfter: res.headers.get("retry-after"), ms: now() - t0 };
  } catch {
    return { failed: true, ms: now() - t0 }; // offline, DNS, timeout, aborted: all the same to the engine
  } finally {
    clearTimeout(timer);
  }
}

const errorOf = (b: unknown): string | undefined => (typeof b === "object" && b !== null && "error" in b ? String((b as { error: unknown }).error) : undefined);

export function fetchSyncApi(): SyncApi {
  return {
    async state(): Promise<ApiResult<SyncState>> {
      const r = await call("/api/sync/state", { method: "GET" });
      if ("failed" in r) return { ok: false, reason: "offline", ms: r.ms };
      if (r.status === 200 && r.body) return { ok: true, value: r.body as SyncState, ms: r.ms };
      return { ok: false, ...failureFor(r.status, r.retryAfter, errorOf(r.body)), ms: r.ms };
    },
    async getDoc(key: DocKey): Promise<ApiResult<RemoteDoc | null>> {
      const r = await call(`/api/sync/documents/${key}`, { method: "GET" });
      if ("failed" in r) return { ok: false, reason: "offline", ms: r.ms };
      if (r.status === 200 && r.body) return { ok: true, value: r.body as RemoteDoc, ms: r.ms };
      if (r.status === 404) return { ok: true, value: null, ms: r.ms };
      return { ok: false, ...failureFor(r.status, r.retryAfter, errorOf(r.body)), ms: r.ms };
    },
    async putDoc(key, expectedRevision, body, opts): Promise<PutResult> {
      const payload = JSON.stringify({ expectedRevision, body });
      const r = await call(`/api/sync/documents/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload, keepalive: !!opts?.keepalive && payload.length < KEEPALIVE_LIMIT_BYTES });
      if ("failed" in r) return { kind: "fail", reason: "offline", ms: r.ms };
      if (r.status === 200 && r.body && typeof (r.body as { revision?: unknown }).revision === "number") return { kind: "ok", revision: (r.body as { revision: number }).revision, ms: r.ms };
      if (r.status === 409 && r.body) {
        const b = r.body as { revision?: unknown; body?: unknown };
        return { kind: "conflict", revision: typeof b.revision === "number" ? b.revision : 0, body: b.body ?? null, ms: r.ms };
      }
      return { kind: "fail", ...failureFor(r.status, r.retryAfter, errorOf(r.body)), ms: r.ms };
    },
    async consent(): Promise<ApiResult<{ consent: true }>> {
      const r = await call("/api/sync/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept: true }) });
      if ("failed" in r) return { ok: false, reason: "offline", ms: r.ms };
      if (r.status === 200) return { ok: true, value: { consent: true }, ms: r.ms };
      return { ok: false, ...failureFor(r.status, r.retryAfter, errorOf(r.body)), ms: r.ms };
    },
  };
}

export const browserScheduler = () => ({
  now: () => Date.now(),
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  random: () => Math.random(),
  online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
});
