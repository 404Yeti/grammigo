/**
 * A fetch that gives up. Every server-side call to Supabase (Auth, the REST API, the database functions) goes through this, so a Supabase that
 * ACCEPTS a connection and then never answers cannot hold a page or an API call open until the platform's function limit. After `ms` the
 * request is aborted and the caller sees an ordinary network failure, which the account code already treats as "unavailable" (HTTP 503,
 * "try again", never "sign in again"). It limits the whole exchange, including reading the body. A caller's own abort signal still works.
 *
 * Lessons never reach this code: they make no Supabase request at all.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const MIN_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_REQUEST_TIMEOUT_MS = 15_000;

/** The configured value, kept inside its bounds. Anything that is not a whole number falls back to the default. */
export function boundedTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(MIN_REQUEST_TIMEOUT_MS, n));
}

export function fetchWithTimeout(ms: number, base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return (input, init) => {
    const own = [init?.signal, input instanceof Request ? input.signal : undefined].filter((s): s is AbortSignal => !!s);
    const signal = AbortSignal.any([...own, AbortSignal.timeout(ms)]);
    return base(input, { ...init, signal });
  };
}
