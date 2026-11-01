import { clientAddress } from "./client-ip";
import type { JoinError } from "./constants";
import { hashCode, normaliseCode } from "./invite-code";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS } from "./rate-limit";
import type { AuthRuntime } from "./runtime";
import { startGoogle } from "./start";

/** A handler answers with a redirect (the account flows are plain HTML forms) or a bare status. Routes turn this into a Response. */
export type HandlerResult = { status: 303; location: string; retryAfter?: number } | { status: 400 | 403 | 413 | 429 | 503; retryAfter?: number };

const MAX_FORM_BYTES = 2048;
const joinError = (e: JoinError, retryAfter?: number): HandlerResult => ({ status: 303, location: `/join?e=${e}`, retryAfter });

export type JoinInput = { headers: Headers; code: string; adult: boolean };

/**
 * POST /api/auth/join: the invitation code and the 18+ confirmation arrive together. On success the seat is reserved, the signed
 * flow cookie is set and the browser is sent to Google. Nothing is stored about a person at this point: only the reservation.
 */
export async function handleJoin(rt: AuthRuntime, input: JoinInput): Promise<HandlerResult> {
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };

  // Throttle BEFORE touching the invitation table, and count every attempt (a refused request still uses its budget).
  try {
    const who = clientAddress(input.headers);
    const decision = await checkLimits(rt.db.limiter, rt.config.flowSecret, LIMITS.join, who);
    const global = await checkLimits(rt.db.limiter, rt.config.flowSecret, LIMITS.joinGlobal, "all");
    if (!decision.allowed || !global.allowed) {
      const retryAfter = Math.max(!decision.allowed ? decision.retryAfter : 0, !global.allowed ? global.retryAfter : 0);
      rt.log("join", { outcome: "rate_limited" });
      return joinError("rate", retryAfter);
    }
  } catch {
    return joinError("server"); // fail closed
  }

  if (!input.adult) return joinError("adult");

  const code = normaliseCode(input.code);
  if (!code) {
    rt.log("join", { outcome: "malformed" });
    return joinError("invite");
  }

  let reserved;
  try {
    reserved = await rt.db.reserve(hashCode(code, rt.config.pepper));
  } catch {
    return joinError("server");
  }
  if ("error" in reserved) {
    rt.log("join", { outcome: reserved.error });
    return joinError(reserved.error === "invalid" ? "invite" : reserved.error);
  }

  const started = await startGoogle(rt, { intent: "join", grantId: reserved.grantId, adultAt: new Date(rt.now()).toISOString() });
  if (!started.ok) return joinError("server");
  rt.log("join", { outcome: "reserved" });
  return { status: 303, location: started.url };
}

/** POST /api/auth/signin: a returning learner. No invitation is involved, and none is accepted here. */
export async function handleSignIn(rt: AuthRuntime, input: { headers: Headers }): Promise<HandlerResult> {
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  try {
    const decision = await checkLimits(rt.db.limiter, rt.config.flowSecret, LIMITS.signin, clientAddress(input.headers));
    if (!decision.allowed) return { status: 303, location: "/signin?e=rate", retryAfter: decision.retryAfter };
  } catch {
    return { status: 303, location: "/signin?e=server" };
  }
  const started = await startGoogle(rt, { intent: "signin" });
  if (!started.ok) return { status: 303, location: "/signin?e=server" };
  return { status: 303, location: started.url };
}

/** POST /api/auth/signout: ends THIS device's session only, and clears every account cookie whatever the Auth server answers. */
export async function handleSignOut(rt: AuthRuntime, input: { headers: Headers }): Promise<HandlerResult> {
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  try {
    await rt.auth.signOut();
  } catch {
    // the cookies below are what end the session in this browser
  }
  rt.jar.clearAuthCookies();
  return { status: 303, location: "/" };
}

/** Rate limit for the sign-in callback, applied by the route before the exchange so a flood cannot burn Auth server capacity. */
export async function callbackAllowed(rt: AuthRuntime, headers: Headers): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  try {
    const d = await checkLimits(rt.db.limiter, rt.config.flowSecret, LIMITS.callback, clientAddress(headers));
    return d.allowed ? { allowed: true } : { allowed: false, retryAfter: d.retryAfter };
  } catch {
    return { allowed: false, retryAfter: 30 }; // fail closed
  }
}
