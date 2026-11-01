// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkEmailIdentity, checkGoogleIdentity, type AuthUser } from "./identity";
import { emailHash, handleForgot, handleNewPassword, handlePasswordSignIn, handleRecover, handleRegister } from "./password";
import { normaliseEmail, passwordProblem } from "./password-policy";
import { generateCode } from "./invite-code";
import { GRANT, googleUser, makeRuntime, NOW, postHeaders, testConfig, USER_ID } from "./testkit";

const cfg = testConfig();
const code = generateCode();
const GOOD = "correct horse battery staple";
const emailUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: USER_ID, email: "student@example.test", email_confirmed_at: "2026-11-02T10:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [{ provider: "email", identity_data: { email_verified: true } }], ...over,
});
const reg = (m: ReturnType<typeof makeRuntime>, o: Partial<Parameters<typeof handleRegister>[1]> = {}) =>
  handleRegister(m.rt, { headers: postHeaders(cfg), code, email: "Student@Example.test ", password: GOOD, adult: true, ...o });
const loc = (r: { status: number }) => (r as unknown as { location: string }).location;

describe("password rules", () => {
  it("accept long, varied passwords; refuse short, one-character, common, email-like and over-72-byte ones", () => {
    expect(passwordProblem(GOOD, "a@b.test")).toBeNull();
    expect(passwordProblem("short", "a@b.test")).toBe("short");
    expect(passwordProblem("aaaaaaaaaaaaaaaa", "a@b.test")).toBe("repeated");
    expect(passwordProblem("abababababababab", "a@b.test")).toBe("repeated");
    expect(passwordProblem("Password1234", "a@b.test")).toBe("common");
    expect(passwordProblem("student@example.test", "student@example.test")).toBe("email");
    expect(passwordProblem("my-student-password-1", "student@example.test")).toBe("email");
    expect(passwordProblem("x".repeat(73) + "y", "a@b.test")).toBe("long");
    expect(passwordProblem("é".repeat(40), "a@b.test")).toBe("long"); // 80 bytes
  });
  it("addresses are trimmed and lower-cased, and junk is refused", () => {
    expect(normaliseEmail("  Student@Example.TEST ")).toBe("student@example.test");
    for (const bad of ["", "no-at", "a@b", "a b@c.test", "x".repeat(250) + "@a.test", null, 5]) expect(normaliseEmail(bad as never), String(bad)).toBeNull();
  });
});

describe("identity: each method must stand ALONE", () => {
  it("an email identity: confirmed, provider email, exactly one", () => {
    expect(checkEmailIdentity(emailUser())).toEqual({ ok: true });
    expect(checkEmailIdentity(emailUser({ email_confirmed_at: null }))).toEqual({ ok: false, reason: "unverified" });
    expect(checkEmailIdentity(googleUser())).toEqual({ ok: false, reason: "provider" });
  });
  it("a user that has BOTH identities is refused by both checks (never silently joined)", () => {
    const both = emailUser({ app_metadata: { provider: "email", providers: ["email", "google"] }, identities: [{ provider: "email" }, { provider: "google", identity_data: { email_verified: true } }] });
    expect(checkEmailIdentity(both)).toEqual({ ok: false, reason: "linked" });
    expect(checkGoogleIdentity({ ...both, app_metadata: { provider: "google", providers: ["email", "google"] } })).toEqual({ ok: false, reason: "linked" });
  });
});

describe("registering with email + password", () => {
  it("reserves a seat for exactly that address, creates the account, and sends the person to 'check your email'; no session, nothing redeemed", async () => {
    const m = makeRuntime();
    const r = await reg(m);
    expect(r).toMatchObject({ status: 303, location: "/auth/check-email?k=confirm" });
    expect(m.calls).toEqual(expect.arrayContaining(["emailState:student@example.test", "reserveForEmail", "signUp"]));
    expect(m.calls).not.toContain("redeemForEmail");
    expect(m.calls).not.toContain("redeem:x");
    expect(m.cookies.outgoing.size).toBe(0);
  });
  it("an address that already has a profile (any method), or a Google identity, is refused and nothing is touched", async () => {
    for (const state of [{ userId: "u", providers: ["email"], confirmed: true, hasProfile: true }, { userId: "u", providers: ["google"], confirmed: true, hasProfile: false }, { userId: "u", providers: ["email", "google"], confirmed: true, hasProfile: false }]) {
      const m = makeRuntime({ emailState: state });
      expect(loc(await reg(m))).toBe("/join/email?e=taken");
      expect(m.calls).not.toContain("purge");
      expect(m.calls).not.toContain("reserveForEmail");
      expect(m.calls).not.toContain("signUp");
    }
  });
  it("an Auth user that is waiting for its confirmation (profile-less, email-only) is NEVER deleted or touched by another registration: refused, no seat, no mail", async () => {
    const m = makeRuntime({ emailState: { userId: "pending", providers: ["email"], confirmed: false, hasProfile: false } });
    expect(loc(await reg(m))).toBe("/join/email?e=taken");
    for (const call of ["purge", "reserveForEmail", "signUp", "release"]) expect(m.calls).not.toContain(call);
  });
  it("if the Auth server signs the person in at once (email confirmation is OFF), that is a failure: session ended, seat given back, no access", async () => {
    const m = makeRuntime({ signUp: { ok: true, sessionCreated: true } });
    expect(loc(await reg(m))).toBe("/join/email?e=server");
    expect(m.calls).toEqual(expect.arrayContaining(["signOut", "release"]));
    expect(m.logs.some((l) => l.fields?.outcome === "confirmation_off")).toBe(true);
  });
  it("a failed sign-up gives the seat back", async () => {
    const m = makeRuntime({ signUp: { ok: false, sessionCreated: false } });
    expect(loc(await reg(m))).toBe("/join/email?e=server");
    expect(m.calls).toContain("release");
    const t = makeRuntime({ signUp: "throw" });
    expect(loc(await reg(t))).toBe("/join/email?e=server");
    expect(t.calls).toContain("release");
  });
  it("every refusal comes BEFORE the seat or the account: no 18+, bad address, weak password, malformed code, wrong origin, oversize", async () => {
    for (const [over, expected] of [[{ adult: false }, "adult"], [{ email: "nope" }, "email"], [{ password: "short" }, "pw_short"], [{ password: "Password1234" }, "pw_common"], [{ code: "!!!" }, "invite"]] as const) {
      const m = makeRuntime();
      expect(loc(await reg(m, over)), JSON.stringify(over)).toBe(`/join/email?e=${expected}`);
      expect(m.calls).not.toContain("reserveForEmail");
      expect(m.calls).not.toContain("signUp");
    }
    const evil = makeRuntime();
    expect((await handleRegister(evil.rt, { headers: new Headers({ origin: "https://evil.example" }), code, email: "a@b.test", password: GOOD, adult: true })).status).toBe(403);
    expect(evil.calls).toEqual([]);
    expect((await handleRegister(makeRuntime().rt, { headers: postHeaders(cfg, { "content-length": "99999" }), code, email: "a@b.test", password: GOOD, adult: true })).status).toBe(413);
  });
  it("invitation problems are reported as for Google; the account is not created", async () => {
    for (const error of ["revoked", "expired", "full", "invalid"] as const) {
      const m = makeRuntime({ reserveEmail: { error } });
      expect(loc(await reg(m))).toBe(`/join/email?e=${error === "invalid" ? "invite" : error}`);
      expect(m.calls).not.toContain("signUp");
    }
  });
  it("is rate limited per network address AND per mailbox, and fails closed", async () => {
    const m = makeRuntime({ limiter: { allowed: false, retryAfter: 40 } });
    expect(await reg(m)).toMatchObject({ status: 303, location: "/join/email?e=rate", retryAfter: 40 });
    expect(m.calls).not.toContain("reserveForEmail");
    expect(loc(await reg(makeRuntime({ limiter: "throw" })))).toBe("/join/email?e=server");
  });
  it("the mailbox hash is keyed and case-insensitive", () => {
    expect(emailHash("A@B.test", cfg.flowSecret).equals(emailHash("a@b.test", cfg.flowSecret))).toBe(true);
    expect(emailHash("a@b.test", cfg.flowSecret).equals(emailHash("a@b.test", cfg.pepper))).toBe(false);
  });
});

describe("signing in with email + password", () => {
  const signin = (m: ReturnType<typeof makeRuntime>, o: Partial<Parameters<typeof handlePasswordSignIn>[1]> = {}) => handlePasswordSignIn(m.rt, { headers: postHeaders(cfg), email: "student@example.test", password: GOOD, ...o });
  it("an active learner is signed in and pointed at their own progress folder", async () => {
    const m = makeRuntime({ user: emailUser(), profile: "active" });
    expect(await signin(m)).toMatchObject({ status: 303, location: "/account" });
    expect(m.cookies.outgoing.get(cfg.cookieNames.scope)?.value).toBe(USER_ID);
  });
  it("a confirmed address with no profile redeems the seat reserved for exactly that address, once", async () => {
    const m = makeRuntime({ user: emailUser(), profile: "none", redeemEmail: "ok" });
    expect(await signin(m)).toMatchObject({ location: "/account?welcome=1" });
    expect(m.calls).toContain("redeemForEmail");
  });
  it("no reservation (or an expired or revoked one): no access, the session is ended, the leftover is deleted", async () => {
    for (const redeemEmail of ["invalid", "expired", "revoked"] as const) {
      const m = makeRuntime({ user: emailUser(), profile: "none", redeemEmail });
      expect(loc(await signin(m))).toBe("/signin?e=noaccount");
      expect(m.calls).toEqual(expect.arrayContaining(["signOut", "purge"]));
      expect(m.cookies.outgoing.get(cfg.cookieNames.scope)?.value ?? "").toBe("");
    }
  });
  it("a wrong password, an unknown address and a malformed form look the same; 'not confirmed' is its own message; nothing is looked up", async () => {
    const bad = makeRuntime({ passwordSignIn: { ok: false, reason: "invalid" } });
    expect(loc(await signin(bad))).toBe("/signin?e=credentials");
    expect(bad.calls).not.toContain("getUser");
    expect(loc(await signin(makeRuntime({ passwordSignIn: { ok: false, reason: "unconfirmed" } })))).toBe("/signin?e=unconfirmed");
    expect(loc(await signin(makeRuntime(), { email: "nope" }))).toBe("/signin?e=credentials");
    expect(loc(await signin(makeRuntime(), { password: "" }))).toBe("/signin?e=credentials");
    expect(loc(await signin(makeRuntime({ passwordSignIn: { ok: false, reason: "unavailable" } })))).toBe("/signin?e=server");
    expect(loc(await signin(makeRuntime({ passwordSignIn: "throw" })))).toBe("/signin?e=server");
  });
  it("an account that also has a Google identity is refused (not joined), signed out, and NOT deleted", async () => {
    const both = emailUser({ app_metadata: { provider: "email", providers: ["email", "google"] }, identities: [{ provider: "email" }, { provider: "google" }] });
    const m = makeRuntime({ user: both, profile: "active" });
    expect(loc(await signin(m))).toBe("/signin?e=linked");
    expect(m.calls).toContain("signOut");
    expect(m.calls).not.toContain("purge");
    expect(m.cookies.outgoing.get(cfg.cookieNames.scope)?.value ?? "").toBe("");
  });
  it("an unconfirmed identity that somehow got a session is refused and cleaned up", async () => {
    const m = makeRuntime({ user: emailUser({ email_confirmed_at: null }), profile: "none" });
    expect(loc(await signin(m))).toBe("/signin?e=credentials");
    expect(m.calls).toEqual(expect.arrayContaining(["signOut", "purge"]));
  });
  it("a suspended account is refused and never deleted", async () => {
    const m = makeRuntime({ user: emailUser(), profile: "suspended" });
    expect(loc(await signin(m))).toBe("/signin?e=suspended");
    expect(m.calls).not.toContain("purge");
  });
  it("confirming oneself again: only the SAME account may come back, and it returns to the delete page", async () => {
    const same = makeRuntime({ user: emailUser(), profile: "active" });
    expect(await signin(same, { reauthUserId: USER_ID })).toMatchObject({ location: "/account/delete" });
    const other = makeRuntime({ user: emailUser({ id: "99999999-9999-4999-8999-999999999999" }), profile: "active" });
    expect(loc(await signin(other, { reauthUserId: USER_ID }))).toBe("/account/delete?e=credentials");
    expect(other.calls).toContain("signOut");
    const none = makeRuntime({ user: emailUser(), profile: "none" });
    expect(loc(await signin(none, { reauthUserId: USER_ID }))).toBe("/account/delete?e=credentials");
    expect(none.calls).not.toContain("redeemForEmail"); // confirming oneself can never create an account
  });
  it("is rate limited by address and by mailbox before any password is tried, and refuses a foreign origin", async () => {
    const m = makeRuntime({ limiter: { allowed: false, retryAfter: 30 } });
    expect(await signin(m)).toMatchObject({ location: "/signin?e=rate", retryAfter: 30 });
    expect(m.calls).not.toContain("signInWithPassword");
    expect((await handlePasswordSignIn(makeRuntime().rt, { headers: new Headers({ origin: "https://evil.example" }), email: "a@b.test", password: "x" })).status).toBe(403);
  });
});

describe("forgot password", () => {
  const forgot = (m: ReturnType<typeof makeRuntime>) => handleForgot(m.rt, { headers: postHeaders(cfg), email: "Student@Example.test" });
  const answered = { status: 303, location: "/auth/check-email?k=reset" };
  it("sends a reset email only for a confirmed, email-only account with a profile — and the answer is identical in every case", async () => {
    const ok = makeRuntime({ emailState: { userId: "u", providers: ["email"], confirmed: true, hasProfile: true } });
    expect(await forgot(ok)).toMatchObject(answered);
    expect(ok.calls).toContain("sendPasswordReset");
    for (const state of [null as import("./db").EmailState | null, { userId: "u", providers: ["google"], confirmed: true, hasProfile: true }, { userId: "u", providers: ["email", "google"], confirmed: true, hasProfile: true }, { userId: "u", providers: ["email"], confirmed: false, hasProfile: false }, { userId: "u", providers: ["email"], confirmed: true, hasProfile: false }]) {
      const m = makeRuntime({ emailState: state });
      expect(await forgot(m), JSON.stringify(state)).toMatchObject(answered);
      expect(m.calls).not.toContain("sendPasswordReset");
    }
    expect(await forgot(makeRuntime({ emailState: "throw" }))).toMatchObject(answered);
  });
  it("is rate limited and cross-site requests are refused", async () => {
    expect(await forgot(makeRuntime({ limiter: { allowed: false, retryAfter: 9 } }))).toMatchObject({ location: "/auth/forgot?e=rate", retryAfter: 9 });
    expect((await handleForgot(makeRuntime().rt, { headers: new Headers({ origin: "https://evil.example" }), email: "a@b.test" })).status).toBe(403);
  });
});

describe("the reset link and the new password", () => {
  it("a reset link works only for an email-only account with a profile; anything else ends the session", async () => {
    const ok = makeRuntime({ user: emailUser(), profile: "active" });
    expect(await handleRecover(ok.rt, { code: "abc" })).toMatchObject({ location: "/auth/new-password" });
    for (const [user, profile] of [[googleUser(), "active"], [emailUser(), "none"], [emailUser({ email_confirmed_at: null }), "active"]] as const) {
      const m = makeRuntime({ user, profile });
      expect(await handleRecover(m.rt, { code: "abc" })).toMatchObject({ location: "/auth/error?r=recover" });
      expect(m.calls).toContain("signOut");
    }
    expect(await handleRecover(makeRuntime({ exchangeOk: false }).rt, { code: "abc" })).toMatchObject({ location: "/auth/error?r=recover" });
    expect(await handleRecover(makeRuntime().rt, { code: null })).toMatchObject({ location: "/auth/error?r=recover" });
    expect(await handleRecover(makeRuntime().rt, { code: "x".repeat(3000) })).toMatchObject({ location: "/auth/error?r=recover" });
  });
  it("a new password is checked, saved, and then EVERY session is ended", async () => {
    const m = makeRuntime({ user: emailUser(), profile: "active" });
    const r = await handleNewPassword(m.rt, { headers: postHeaders(cfg), password: GOOD, confirm: GOOD });
    expect(r).toMatchObject({ location: "/signin?e=pwchanged" });
    expect(m.calls.indexOf("updatePassword")).toBeLessThan(m.calls.indexOf("signOutEverywhere"));
  });
  it("refuses a mismatch, a weak password, a signed-out visitor, a Google account and a foreign origin, changing nothing", async () => {
    const h = postHeaders(cfg);
    const mis = makeRuntime({ user: emailUser(), profile: "active" });
    expect(await handleNewPassword(mis.rt, { headers: h, password: GOOD, confirm: "different one entirely" })).toMatchObject({ location: "/auth/new-password?e=mismatch" });
    expect(await handleNewPassword(makeRuntime({ user: emailUser(), profile: "active" }).rt, { headers: h, password: "short", confirm: "short" })).toMatchObject({ location: "/auth/new-password?e=pw_short" });
    for (const m of [makeRuntime({ user: null }), makeRuntime({ user: googleUser(), profile: "active" }), makeRuntime({ user: emailUser(), profile: "none" })]) {
      expect(await handleNewPassword(m.rt, { headers: h, password: GOOD, confirm: GOOD })).toMatchObject({ location: "/signin?e=session" });
      expect(m.calls).not.toContain("updatePassword");
    }
    expect((await handleNewPassword(makeRuntime().rt, { headers: new Headers({ origin: "https://evil.example" }), password: GOOD, confirm: GOOD })).status).toBe(403);
    void NOW; void GRANT;
  });
});
