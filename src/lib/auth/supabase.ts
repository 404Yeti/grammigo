import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { AuthConfig } from "./config";
import { fetchWithTimeout } from "./timeout-fetch";

/** Session cookies live for a week of inactivity; they are rewritten (sliding) whenever the session is refreshed. */
const SESSION_COOKIE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Every cookie we set is httpOnly (the browser never talks to Supabase, so script has no business reading a token),
 * SameSite=Lax (needed so the cookie survives the redirect back from Google, and no weaker), path "/", and Secure on https.
 * Removals (maxAge 0) keep their zero lifetime.
 */
export function hardenCookie(options: CookieOptions | undefined, config: Pick<AuthConfig, "secureCookies">): CookieOptions {
  const removing = options?.maxAge === 0;
  return {
    ...options,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    domain: undefined, // required by the __Host- prefix, and keeps the cookie off sibling subdomains
    maxAge: removing ? 0 : Math.min(options?.maxAge ?? SESSION_COOKIE_SECONDS, SESSION_COOKIE_SECONDS),
  };
}

export type CookieStoreLike = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

/** A Supabase client acting AS THE SIGNED-IN USER (anon key + the user's session). Row-level security applies to everything it does. */
export function createSessionClient(config: AuthConfig, store: CookieStoreLike, onHeaders?: (h: Record<string, string>) => void): SupabaseClient {
  return createServerClient(config.supabaseUrl, config.anonKey, {
    cookieOptions: { name: config.cookieNames.auth },
    auth: { flowType: "pkce", detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout(config.requestTimeoutMs) }, // a Supabase that never answers must not hold the page open
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookies, headers) => {
        for (const c of cookies) {
          try {
            store.set(c.name, c.value, hardenCookie(c.options, config));
          } catch {
            // Server Components cannot write cookies; the proxy refreshes the session for those requests.
          }
        }
        onHeaders?.(headers);
      },
    },
  });
}

/**
 * The SERVICE ROLE client: it bypasses row-level security. It exists only in this server-only module, is created per use, never
 * persists a session, and is used only for the narrow operations in `db.ts` (never to answer a learner's own data request).
 */
export function createServiceClient(config: AuthConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchWithTimeout(config.requestTimeoutMs) } });
}
