import { createHmac } from "node:crypto";
import { RECOVERY_TOKEN } from "./recovery-token";
import { clientAddress } from "./client-ip";
import { PRIVACY_NOTICE_VERSION } from "./constants";
import { hashCode, normaliseCode } from "./invite-code";
import { checkEmailIdentity, displayNameFrom } from "./identity";
import { isTrustedOrigin } from "./origin";
import { normaliseEmail, passwordProblem } from "./password-policy";
import { checkLimits, LIMITS, type LimitRule } from "./rate-limit";
import type { AuthRuntime } from "./runtime";
import type { HandlerResult } from "./handlers";

/**
 * Email + password, INVITATION-ONLY. Passwords are stored and checked by Supabase Auth; this code never sees one after handing it over.
 *
 * REGISTER   code + 18+ + address + password. Order matters:
 *   1. same-origin, size, rate limits (per network address AND per mailbox),
 *   2. the password rules, the address, the invitation code,
 *   3. the address must not already be someone's: an address that has a profile (any sign-in method) is refused, so two methods are never joined;
 *      a profile-less leftover for that address (a half-finished registration, or someone squatting on it through the public Auth API) is deleted,
 *   4. a seat is reserved for exactly that address (24 hours), with the 18+ confirmation recorded,
 *   5. Supabase creates the account and emails a confirmation link. If it signs the person in AT ONCE (email confirmation switched off), that is
 *      treated as a failure: the session is ended and the seat given back. Nothing here ever relies on confirmation being off.
 * The account has NO access until the first sign-in with the password AFTER the mailbox is confirmed redeems that seat (the profile row is the gate).
 *
 * SIGN IN    Supabase checks the password (and rate limits). Then OUR checks: the identity stands alone (provider email only) and is confirmed; an active
 *   profile signs in; none means the seat reserved for this exact address is redeemed, else no access and the leftover is deleted.
 * FORGOT     a reset email is sent only for an address whose account is email-only, confirmed and has a profile. The answer is the same either way.
 * NEW PASSWORD  only inside a recovery session for an email-only account with a profile; afterwards every session of the person is ended.
 */
const MAX_FORM_BYTES = 4096;
const FIELD = 200;

/** A keyed hash of the address: what the database stores to match a seat to a mailbox, and what rate limits count by. */
export const emailHash = (email: string, secret: Buffer): Buffer => createHmac("sha256", secret).update(`gm-email-v1:${email.toLowerCase()}`).digest();

const registerError = (e: string, retryAfter?: number): HandlerResult => ({ status: 303, location: `/join/email?e=${e}`, retryAfter });

async function limited(rt: AuthRuntime, rules: LimitRule[], subject: string): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const d = await checkLimits(rt.db.limiter, rt.config.flowSecret, rules, subject);
  return d.allowed ? { allowed: true } : { allowed: false, retryAfter: d.retryAfter };
}

async function endSession(rt: AuthRuntime): Promise<void> {
  try {
    await rt.auth.signOut();
  } catch {
    // the cookies are cleared below whatever the Auth server said
  }
  rt.jar.clearAuthCookies();
}

async function cleanup(rt: AuthRuntime, userId: string): Promise<void> {
  try {
    await rt.db.purgeOrphan(userId); // refuses anyone with a profile or an admin row
  } catch {
    rt.log("cleanup_failed");
  }
}

// ---------------------------------------------------------------- register
export type RegisterInput = { headers: Headers; code: string; email: string; password: string; adult: boolean };

export async function handleRegister(rt: AuthRuntime, input: RegisterInput): Promise<HandlerResult> {
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };
  const email = normaliseEmail(input.email);
  try {
    const who = clientAddress(input.headers);
    const ip = await limited(rt, LIMITS.register, who);
    const byMailbox = email ? await limited(rt, LIMITS.registerEmail, emailHash(email, rt.config.flowSecret).toString("hex")) : ({ allowed: true } as const);
    const global = await limited(rt, LIMITS.joinGlobal, "all");
    if (!ip.allowed || !byMailbox.allowed || !global.allowed) {
      rt.log("register", { outcome: "rate_limited" });
      return registerError("rate", Math.max(ip.allowed ? 0 : ip.retryAfter, byMailbox.allowed ? 0 : byMailbox.retryAfter, global.allowed ? 0 : global.retryAfter));
    }
  } catch {
    return registerError("server"); // fail closed
  }

  if (!input.adult) return registerError("adult");
  if (!email) return registerError("email");
  const problem = passwordProblem(input.password, email);
  if (problem) return registerError(`pw_${problem}`);
  const code = normaliseCode(input.code);
  if (!code) {
    rt.log("register", { outcome: "malformed" });
    return registerError("invite");
  }

  // 3. the address
  try {
    const state = await rt.db.emailState(email);
    // An Auth user already holds this address. Whatever it is (a finished account, a Google identity, or a registration still waiting for its
    // confirmation), registering NEVER deletes or touches it, reserves no seat and sends no mail: another person presenting the same address must not
    // be able to destroy someone's pending registration. A profile-less leftover is removed only by the scheduled sweep, once it is older than the
    // seat's hold (see `runCleanup`), and it has no access in the meantime.
    if (state) {
      rt.log("register", { outcome: "taken" });
      return registerError("taken");
    }
  } catch {
    return registerError("server");
  }

  // 4. the seat
  let reserved;
  const hash = emailHash(email, rt.config.flowSecret);
  try {
    reserved = await rt.db.reserveForEmail(hashCode(code, rt.config.pepper), hash, new Date(rt.now()).toISOString());
  } catch {
    return registerError("server");
  }
  if ("error" in reserved) {
    rt.log("register", { outcome: reserved.error });
    return registerError(reserved.error === "invalid" ? "invite" : reserved.error);
  }

  // 5. the account
  const giveBack = async () => rt.db.release(reserved.grantId).catch(() => undefined);
  let made;
  try {
    made = await rt.auth.signUp(email, input.password, `${rt.config.siteUrl.origin}/auth/confirmed`);
  } catch {
    await giveBack();
    return registerError("server");
  }
  if (!made.ok || made.sessionCreated) {
    if (made.sessionCreated) {
      rt.log("register", { outcome: "confirmation_off" }); // a project setting is wrong: fail closed
      await endSession(rt);
    }
    await giveBack();
    return registerError("server");
  }
  rt.log("register", { outcome: "pending_confirmation" });
  return { status: 303, location: "/auth/check-email?k=confirm" };
}

// ---------------------------------------------------------------- sign in
export type PasswordSignInInput = { headers: Headers; email: string; password: string; /** Set when a signed-in person is confirming themselves again: only the SAME account may come back. */ reauthUserId?: string };

export async function handlePasswordSignIn(rt: AuthRuntime, input: PasswordSignInInput): Promise<HandlerResult> {
  const back = input.reauthUserId ? "/account/delete" : "/signin";
  const fail = (e: string, retryAfter?: number): HandlerResult => ({ status: 303, location: `${back}?e=${e}`, retryAfter });
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };
  const email = normaliseEmail(input.email);
  if (!email || typeof input.password !== "string" || input.password.length === 0 || input.password.length > FIELD) return fail("credentials");
  try {
    const ip = await limited(rt, LIMITS.loginByEmail, clientAddress(input.headers));
    const mailbox = await limited(rt, LIMITS.loginByEmailMailbox, emailHash(email, rt.config.flowSecret).toString("hex"));
    if (!ip.allowed || !mailbox.allowed) {
      rt.log("password_signin", { outcome: "rate_limited" });
      return fail("rate", Math.max(ip.allowed ? 0 : ip.retryAfter, mailbox.allowed ? 0 : mailbox.retryAfter));
    }
  } catch {
    return fail("server");
  }

  const result = await rt.auth.signInWithPassword(email, input.password).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (!result.ok) {
    rt.log("password_signin", { outcome: result.reason });
    return fail(result.reason === "unconfirmed" ? "unconfirmed" : result.reason === "rate" ? "rate" : result.reason === "unavailable" ? "server" : "credentials");
  }

  const refuse = async (outcome: string, e: string, userId?: string): Promise<HandlerResult> => {
    await endSession(rt);
    if (userId) await cleanup(rt, userId);
    rt.log("password_signin", { outcome });
    return fail(e);
  };
  try {
    const user = await rt.auth.getUser();
    if (!user) return refuse("exchange", "server");
    if (input.reauthUserId && user.id !== input.reauthUserId) return refuse("reauth_mismatch", "credentials"); // someone else's password cannot stand in
    const verdict = checkEmailIdentity(user);
    if (!verdict.ok) return refuse(verdict.reason, verdict.reason === "linked" ? "linked" : "credentials", verdict.reason === "unverified" ? user.id : undefined);
    const profile = await rt.db.profileState(user.id);
    if (profile === "suspended") return refuse("suspended", "suspended");
    if (profile === "active") {
      rt.jar.setScope(user.id);
      rt.log("password_signin", { outcome: input.reauthUserId ? "reauthenticated" : "signed_in" });
      return { status: 303, location: input.reauthUserId ? "/account/delete" : "/account" };
    }
    if (input.reauthUserId) return refuse("no_profile", "credentials");
    // no profile yet: the seat reserved for exactly this confirmed address, if there is one
    const redeemed = await rt.db.redeemForEmail({ userId: user.id, emailHash: emailHash(email, rt.config.flowSecret), displayName: displayNameFrom(user), noticeVersion: PRIVACY_NOTICE_VERSION });
    if (redeemed === "ok" || redeemed === "already_registered") {
      rt.jar.setScope(user.id);
      rt.log("password_signin", { outcome: "joined" });
      return { status: 303, location: "/account?welcome=1" };
    }
    return refuse("no_account", "noaccount", user.id);
  } catch {
    await endSession(rt);
    return fail("server");
  }
}

// ---------------------------------------------------------------- forgot / new password
export async function handleForgot(rt: AuthRuntime, input: { headers: Headers; email: string }): Promise<HandlerResult> {
  const done: HandlerResult = { status: 303, location: "/auth/check-email?k=reset" };
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };
  const email = normaliseEmail(input.email);
  if (!email) return { status: 303, location: "/auth/forgot?e=email" };
  try {
    const ip = await limited(rt, LIMITS.forgot, clientAddress(input.headers));
    const mailbox = await limited(rt, LIMITS.forgotEmail, emailHash(email, rt.config.flowSecret).toString("hex"));
    if (!ip.allowed || !mailbox.allowed) return { status: 303, location: "/auth/forgot?e=rate", retryAfter: Math.max(ip.allowed ? 0 : ip.retryAfter, mailbox.allowed ? 0 : mailbox.retryAfter) };
  } catch {
    return { status: 303, location: "/auth/forgot?e=server" };
  }
  try {
    const state = await rt.db.emailState(email);
    // Only an email-only, confirmed account with a profile gets a reset email. A Google account does not (it would attach a password to it), an
    // unconfirmed or profile-less address does not, and the person asking cannot tell which case they were.
    if (state && state.confirmed && state.hasProfile && state.providers.length === 1 && state.providers[0] === "email") {
      await rt.auth.sendPasswordReset(email, `${rt.config.siteUrl.origin}/api/auth/recover`);
    }
  } catch {
    // same answer: nothing is revealed by a failure here
  }
  rt.log("forgot", { outcome: "answered" });
  return done;
}

const RECOVER_ERROR: HandlerResult = { status: 303, location: "/auth/error?r=recover" };

/** After a reset link has produced a session: only an email-only account that has a profile may go on to choose a new password. */
async function finishRecovery(rt: AuthRuntime): Promise<HandlerResult> {
  const user = await rt.auth.getUser();
  if (!user || !checkEmailIdentity(user).ok || (await rt.db.profileState(user.id)) !== "active") {
    await endSession(rt);
    rt.log("recover", { outcome: "refused" });
    return RECOVER_ERROR;
  }
  rt.log("recover", { outcome: "ok" });
  return { status: 303, location: "/auth/new-password" };
}

/**
 * GET /api/auth/recover?code=…: the older, same-browser reset link (PKCE). Kept for a project whose reset email still has the default link;
 * it only works in the browser that asked for the reset.
 */
export async function handleRecover(rt: AuthRuntime, input: { code: string | null }): Promise<HandlerResult> {
  if (!input.code || input.code.length > 2048) return RECOVER_ERROR;
  try {
    const exchanged = await rt.auth.exchangeCodeForSession(input.code);
    if (!exchanged.ok) return RECOVER_ERROR;
    return await finishRecovery(rt);
  } catch {
    await endSession(rt);
    return { status: 303, location: "/auth/error?r=server" };
  }
}


/**
 * POST /api/auth/recover: the reset email's link opens /auth/reset (which changes nothing, so a mail scanner that fetches the link cannot use the
 * one-time token up); pressing its button posts the token here. The token is checked by the Auth server and the person gets a recovery session
 * on THIS browser, whichever browser or device asked for the reset. Same limits as before: email-only account with a profile, rate limited, origin checked.
 */
export async function handleRecoverToken(rt: AuthRuntime, input: { headers: Headers; tokenHash: string }): Promise<HandlerResult> {
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };
  if (!RECOVERY_TOKEN.test(input.tokenHash)) return RECOVER_ERROR;
  try {
    const d = await limited(rt, LIMITS.recover, clientAddress(input.headers));
    if (!d.allowed) return { status: 429, retryAfter: d.retryAfter };
  } catch {
    return { status: 503 }; // fail closed
  }
  try {
    const verified = await rt.auth.verifyRecoveryToken(input.tokenHash);
    if (!verified.ok) return RECOVER_ERROR;
    return await finishRecovery(rt);
  } catch {
    await endSession(rt);
    return { status: 303, location: "/auth/error?r=server" };
  }
}

export async function handleNewPassword(rt: AuthRuntime, input: { headers: Headers; password: string; confirm: string }): Promise<HandlerResult> {
  const fail = (e: string, retryAfter?: number): HandlerResult => ({ status: 303, location: `/auth/new-password?e=${e}`, retryAfter });
  if (!isTrustedOrigin(input.headers, rt.config.siteUrl)) return { status: 403 };
  if (Number(input.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { status: 413 };
  try {
    const d = await limited(rt, LIMITS.resetChoose, clientAddress(input.headers));
    if (!d.allowed) return fail("rate", d.retryAfter);
  } catch {
    return fail("server");
  }
  try {
    const user = await rt.auth.getUser();
    if (!user || !checkEmailIdentity(user).ok || (await rt.db.profileState(user.id)) !== "active") return { status: 303, location: "/signin?e=session" };
    if (input.password !== input.confirm) return fail("mismatch");
    const problem = passwordProblem(input.password, user.email ?? "");
    if (problem) return fail(`pw_${problem}`);
    const r = await rt.auth.updatePassword(input.password);
    if (!r.ok) return fail(r.reason === "weak" ? "pw_common" : r.reason === "same" ? "same" : "server");
    await rt.auth.signOutEverywhere().catch(() => undefined); // a changed password ends every session, on every device
    rt.jar.clearAuthCookies();
    rt.log("new_password", { outcome: "ok" });
    return { status: 303, location: "/signin?e=pwchanged" };
  } catch {
    return fail("server");
  }
}
