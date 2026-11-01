import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "./config";
import { CookieSession } from "./cookie-session";
import { accountDb, type AccountDb } from "./db";
import { FLOW_TTL_SECONDS } from "./flow";
import type { AuthUser } from "./identity";
import { createServiceClient, createSessionClient, hardenCookie } from "./supabase";

/** What the account handlers need. Real in production (see `buildRuntime`); fakes in unit tests; real database in integration tests. */
export interface SessionAuth {
  exchangeCodeForSession(code: string): Promise<{ ok: boolean }>;
  getUser(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  /** The Google authorize URL, with PKCE (the code verifier is stored in the jar). Null if it could not be built. */
  startOAuth(redirectTo: string): Promise<string | null>;
}

export interface FlowJar {
  readFlow(): string | undefined;
  setFlow(token: string): void;
  clearFlow(): void;
  /**
   * Tells the browser WHICH learner's saved progress to use on this device (see lib/scope/storage-scope). The value is the account id: not a
   * secret, not a credential, and unreadable-as-authority (it grants nothing; the session cookie is what proves who someone is). It is
   * deliberately readable by page script, because the lesson store needs it synchronously, before any network call.
   */
  setScope(userId: string): void;
  /** Removes the session cookie, its chunks and the PKCE verifier. Used on every refused sign-in, whatever else fails. */
  clearAuthCookies(): void;
}

export type LogFields = Record<string, string | number | boolean>;

export interface AuthRuntime {
  config: AuthConfig;
  db: AccountDb;
  auth: SessionAuth;
  jar: FlowJar;
  now(): number;
  /** Structured, content-free events. Never pass an email, name, code, token or address. */
  log(event: string, fields?: LogFields): void;
}

export function flowJar(config: AuthConfig, cookies: CookieSession): FlowJar {
  const base = hardenCookie({}, config);
  return {
    readFlow: () => cookies.get(config.cookieNames.flow),
    setFlow: (token) => cookies.set(config.cookieNames.flow, token, { ...base, maxAge: FLOW_TTL_SECONDS }),
    clearFlow: () => cookies.delete(config.cookieNames.flow, base),
    setScope: (userId) => cookies.set(config.cookieNames.scope, userId, { ...base, httpOnly: false }),
    clearAuthCookies: () => {
      cookies.deleteWithPrefix(config.cookieNames.auth, base);
      cookies.delete(config.cookieNames.flow, base);
      cookies.delete(config.cookieNames.scope, { ...base, httpOnly: false });
    },
  };
}

export function sessionAuth(client: SupabaseClient): SessionAuth {
  return {
    async exchangeCodeForSession(code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      return { ok: !error };
    },
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return error || !data.user ? null : (data.user as unknown as AuthUser);
    },
    async signOut() {
      await client.auth.signOut({ scope: "local" });
    },
    async startOAuth(redirectTo) {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
      });
      return error ? null : (data.url ?? null);
    },
  };
}

export function log(event: string, fields: LogFields = {}): void {
  console.info(JSON.stringify({ evt: `auth.${event}`, ...fields }));
}

/** The handlers' runtime plus the two raw clients some routes need: the user's own (RLS applies) and the service role. */
export type BuiltRuntime = AuthRuntime & { session: SupabaseClient; service: SupabaseClient };

export function buildRuntime(config: AuthConfig, cookies: CookieSession): BuiltRuntime {
  const session = createSessionClient(config, cookies);
  const service = createServiceClient(config);
  return {
    config,
    session,
    service,
    db: accountDb(service),
    auth: sessionAuth(session),
    jar: flowJar(config, cookies),
    now: () => Date.now(),
    log,
  };
}
