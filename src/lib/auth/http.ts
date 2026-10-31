import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import type { AuthConfig } from "./config";
import { loadAuthConfig } from "./config";
import { CookieSession } from "./cookie-session";
import type { HandlerResult } from "./handlers";
import { buildRuntime, log, type BuiltRuntime } from "./runtime";

/** Headers every account response carries: never cached by the browser, a CDN or a proxy, never embedded, never sniffed. */
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

export function privateJson(status: number, body: unknown, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...PRIVATE_HEADERS, ...extra } });
}

let warned = false;

/**
 * The front door of every account route. Accounts off: 404, as if the route did not exist. Accounts on but mis-configured: 503, and the
 * names (never the values) of what is wrong go to the log once per instance.
 */
export async function authGate(): Promise<{ ok: true; config: AuthConfig } | { ok: false; response: NextResponse }> {
  // Without this, a route that answers before it reads the request (accounts off, or mis-configured) would be PRERENDERED at build time
  // and that early answer baked in, even after the environment is fixed. Account routes must always decide per request.
  await connection();
  const state = loadAuthConfig();
  if (state.state === "disabled") return { ok: false, response: new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS }) };
  if (state.state === "misconfigured") {
    if (!warned) {
      warned = true;
      log("misconfigured", { problems: state.problems.join("; ") });
    }
    return { ok: false, response: privateJson(503, { error: "unavailable" }) };
  }
  return { ok: true, config: state.config };
}

/** A request-scoped runtime: a cookie jar seeded from the request, and clients bound to it. */
export function runtimeFor(config: AuthConfig, req: NextRequest): { rt: BuiltRuntime; cookies: CookieSession } {
  const cookies = new CookieSession(req.cookies.getAll());
  return { rt: buildRuntime(config, cookies), cookies };
}

/** Writes the jar's changes (set and deleted cookies) onto the response. */
export function withCookies(res: NextResponse, cookies: CookieSession): NextResponse {
  for (const [name, { value, options }] of cookies.outgoing) {
    res.cookies.set({
      name,
      value,
      path: options.path ?? "/",
      httpOnly: options.httpOnly,
      secure: options.secure,
      sameSite: options.sameSite as "lax" | "strict" | "none" | undefined,
      maxAge: options.maxAge,
    });
  }
  return res;
}

/** Turns a handler's answer into a response. Redirect targets are made absolute against the CONFIGURED site, never the Host header. */
export function toResponse(result: HandlerResult, config: AuthConfig, cookies: CookieSession): NextResponse {
  const headers: Record<string, string> = { ...PRIVATE_HEADERS };
  if (result.retryAfter) headers["Retry-After"] = String(result.retryAfter);
  if (result.status === 303) {
    headers.Location = new URL(result.location, config.siteUrl).toString();
    return withCookies(new NextResponse(null, { status: 303, headers }), cookies);
  }
  return withCookies(new NextResponse(null, { status: result.status, headers }), cookies);
}
