// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleCallback } from "./callback";
import { signFlow, newNonce } from "./flow";
import { flowToken, googleUser, GRANT, makeRuntime, NOW, USER_ID, testConfig } from "./testkit";

const cfg = testConfig();
const jarWith = (over: Parameters<typeof flowToken>[1] = {}) => {
  const { token, nonce } = flowToken(cfg, over);
  return { cookies: [{ name: cfg.cookieNames.flow, value: token }], nonce };
};
const SESSION = [{ name: `${cfg.cookieNames.auth}`, value: "existing-session" }];

describe("callback: state, flow cookie and PKCE preconditions", () => {
  it("refuses a callback with NO flow cookie before exchanging anything (login CSRF / link replayed into another browser)", async () => {
    const { rt, calls } = makeRuntime();
    const r = await handleCallback(rt, { code: "abc", providerError: null, flowParam: newNonce() });
    expect(r).toEqual({ redirect: "/auth/error?r=state", outcome: "state" });
    expect(calls).not.toContain("exchange");
    expect(calls).not.toContain("redeem:Ana Pérez");
  });

  it("refuses when the URL nonce does not match the cookie nonce", async () => {
    const { cookies } = jarWith();
    const { rt, calls } = makeRuntime({}, cookies);
    const r = await handleCallback(rt, { code: "abc", providerError: null, flowParam: newNonce() });
    expect(r.outcome).toBe("state");
    expect(calls).not.toContain("exchange");
  });

  it("refuses when the URL carries no nonce at all", async () => {
    const { cookies } = jarWith();
    const { rt } = makeRuntime({}, cookies);
    expect((await handleCallback(rt, { code: "abc", providerError: null, flowParam: null })).outcome).toBe("state");
  });

  it("refuses a FORGED flow cookie (valid shape, wrong signature) and a cookie signed with another secret", async () => {
    const nonce = newNonce();
    const forged = signFlow({ v: 1, intent: "join", nonce, grant: GRANT, adultAt: "2026-11-01T00:00:00.000Z", exp: Math.floor(NOW / 1000) + 600 }, Buffer.from("attacker-secret-attacker-secret-attacker"));
    const { rt, calls } = makeRuntime({}, [{ name: cfg.cookieNames.flow, value: forged }]);
    expect((await handleCallback(rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("state");
    expect(calls).not.toContain("exchange");
  });

  it("refuses an EXPIRED flow cookie", async () => {
    const { cookies, nonce } = jarWith({ exp: Math.floor(NOW / 1000) - 1 });
    const { rt, calls } = makeRuntime({}, cookies);
    expect((await handleCallback(rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("state");
    expect(calls).not.toContain("exchange");
  });

  it("treats a provider error (the person pressed Cancel) as a cancel, and gives the reserved seat back at once", async () => {
    const { cookies, nonce } = jarWith();
    const { rt, calls } = makeRuntime({}, cookies);
    const r = await handleCallback(rt, { code: null, providerError: "access_denied", flowParam: nonce });
    expect(r).toEqual({ redirect: "/auth/error?r=cancelled", outcome: "cancelled" });
    expect(calls).toContain("release");
    expect(calls).not.toContain("exchange");
  });

  it("refuses a missing or absurd code", async () => {
    const { cookies, nonce } = jarWith();
    const a = makeRuntime({}, cookies);
    expect((await handleCallback(a.rt, { code: null, providerError: null, flowParam: nonce })).outcome).toBe("exchange");
    const b = makeRuntime({}, cookies);
    expect((await handleCallback(b.rt, { code: "x".repeat(5000), providerError: null, flowParam: nonce })).outcome).toBe("exchange");
    expect(a.calls).not.toContain("exchange");
  });

  it("clears the single-use flow cookie on EVERY outcome", async () => {
    for (const over of [{}, { exchangeOk: false }, { profile: "active" as const }, { redeem: "invalid" as const }]) {
      const { cookies, nonce } = jarWith();
      const m = makeRuntime(over, cookies);
      await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
      expect(m.cookies.outgoing.get(cfg.cookieNames.flow)?.options.maxAge, JSON.stringify(over)).toBe(0);
    }
  });

  it("does NOT sign out a learner who is already signed in when a forged or failed callback arrives (no logout CSRF)", async () => {
    for (const input of [{ code: "abc", providerError: null, flowParam: newNonce() }, { code: null, providerError: "access_denied", flowParam: null }]) {
      const m = makeRuntime({}, SESSION);
      await handleCallback(m.rt, input);
      expect(m.calls).not.toContain("signOut");
      expect(m.cookies.getAll().some((c) => c.name === cfg.cookieNames.auth)).toBe(true);
    }
  });

  it("an exchange that Supabase rejects (bad PKCE verifier, used or expired code) ends in an error page with no profile work", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ exchangeOk: false }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r.outcome).toBe("exchange");
    expect(m.calls).not.toContain("profileState");
    expect(m.calls).not.toContain("purge");
  });
});

describe("callback: identity checks", () => {
  const run = async (user: ReturnType<typeof googleUser> | null) => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ user }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    return { r, m };
  };

  it("never creates a profile for an UNVERIFIED Google email; signs out, removes the identity, releases the seat", async () => {
    const { r, m } = await run(googleUser({ identities: [{ provider: "google", identity_data: { email_verified: false } }] }));
    expect(r).toEqual({ redirect: "/auth/error?r=unverified", outcome: "unverified" });
    expect(m.calls.some((c) => c.startsWith("redeem"))).toBe(false);
    expect(m.calls).toEqual(expect.arrayContaining(["signOut", "purge", "release"]));
  });

  it("refuses a Google identity linked to an existing account (no automatic linking by email)", async () => {
    const linked = googleUser({ app_metadata: { provider: "google", providers: ["email", "google"] }, identities: [{ provider: "email" }, { provider: "google", identity_data: { email_verified: true } }] });
    const { r, m } = await run(linked);
    expect(r.outcome).toBe("identity");
    expect(m.calls.some((c) => c.startsWith("redeem"))).toBe(false);
    expect(m.calls).not.toContain("profileState"); // never even asks whether the (existing) account has a profile
  });

  it("a user the Auth server no longer vouches for (getUser returns nothing) is refused", async () => {
    const { r } = await run(null);
    expect(r.outcome).toBe("exchange");
  });
});

describe("callback: returning learners, joins and uninvited identities", () => {
  it("signs in a returning learner with an active profile, with no invitation involved", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({ profile: "active" }, [{ name: cfg.cookieNames.flow, value: token }]);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/account", outcome: "signed_in" });
    expect(m.calls.some((c) => c.startsWith("redeem"))).toBe(false);
    expect(m.calls).not.toContain("purge");
    expect(m.calls).not.toContain("signOut");
  });

  it("a returning learner who used a JOIN flow is signed in and the unused seat goes back", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ profile: "active" }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r.outcome).toBe("signed_in");
    expect(m.calls).toContain("release");
    expect(m.calls.some((c) => c.startsWith("redeem"))).toBe(false);
  });

  it("a SUSPENDED account is refused and is never cleaned up (it is a real account)", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({ profile: "suspended" }, [{ name: cfg.cookieNames.flow, value: token }]);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r.outcome).toBe("suspended");
    expect(m.calls).toContain("signOut");
    expect(m.calls).not.toContain("purge");
  });

  it("creates the learner through ONE atomic redeem, with the 18+ time from the flow and a bounded display name", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({}, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/account?welcome=1", outcome: "joined" });
    expect(m.calls.filter((c) => c.startsWith("redeem"))).toEqual(["redeem:Ana Pérez"]);
    expect(m.calls).not.toContain("purge");
    expect(m.calls).not.toContain("signOut");
  });

  it.each([
    ["invalid", "/join?e=invite"],
    ["expired", "/join?e=expired"],
    ["revoked", "/join?e=revoked"],
  ] as const)("a grant the database refuses (%s) creates no learner, signs out and deletes the profile-less identity", async (result, redirect) => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ redeem: result }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect, outcome: "invite_unusable" });
    expect(m.calls).toEqual(expect.arrayContaining(["signOut", "purge"]));
  });

  it("'already_registered' (a double-clicked callback that lost the race) is treated as success, not as an uninvited identity", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ redeem: "already_registered" }, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("joined");
    expect(m.calls).not.toContain("purge");
  });

  it("an UNKNOWN Google account on a plain sign-in gets nothing: signed out, identity removed, pointed to the invitation page", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({}, [{ name: cfg.cookieNames.flow, value: token }]);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/auth/no-account", outcome: "no_account" });
    expect(m.calls).toEqual(expect.arrayContaining(["signOut", "purge"]));
    expect(m.calls.some((c) => c.startsWith("redeem"))).toBe(false);
    expect(m.cookies.outgoing.get(cfg.cookieNames.auth)?.options.maxAge).toBeUndefined(); // no stray session set
  });

  it("clears every account cookie it knows about when it refuses", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({}, [{ name: cfg.cookieNames.flow, value: token }, ...SESSION, { name: `${cfg.cookieNames.auth}.0`, value: "chunk" }, { name: `${cfg.cookieNames.auth}-code-verifier`, value: "v" }, { name: "unrelated", value: "keep" }]);
    await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    const gone = [...m.cookies.outgoing].filter(([, v]) => v.options.maxAge === 0).map(([k]) => k);
    expect(gone).toEqual(expect.arrayContaining([cfg.cookieNames.auth, `${cfg.cookieNames.auth}.0`, `${cfg.cookieNames.auth}-code-verifier`, cfg.cookieNames.flow]));
    expect(gone).not.toContain("unrelated");
  });
});

describe("callback: security holds when cleanup or the Auth server fail", () => {
  it("if the identity DELETION fails, the visitor is still refused and signed out (the identity has no profile, so no access)", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({ purge: "throw" }, [{ name: cfg.cookieNames.flow, value: token }]);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r.outcome).toBe("no_account");
    expect(m.cookies.outgoing.get(cfg.cookieNames.auth)?.options.maxAge ?? 0).toBe(0);
    expect(m.logs.map((l) => l.event)).toContain("cleanup_failed");
  });

  it("if signOut throws, the cookies are still cleared", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({ signOut: "throw" }, [{ name: cfg.cookieNames.flow, value: token }, ...SESSION]);
    await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(m.cookies.outgoing.get(cfg.cookieNames.auth)?.options.maxAge).toBe(0);
  });

  it("if the database fails during redeem, nobody is signed in and the visitor can retry", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ redeem: "throw" }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/auth/error?r=server", outcome: "server" });
    expect(m.calls).toContain("signOut");
    expect(m.calls).toContain("release"); // the seat is offered back so a retry works
  });

  it("if the Auth server throws during the exchange, the visitor is refused cleanly", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({ exchangeThrows: true }, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("server");
  });

  it("logs only the outcome, never an email, name, code or token", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({}, cookies);
    await handleCallback(m.rt, { code: "secret-oauth-code", providerError: null, flowParam: nonce });
    const text = JSON.stringify(m.logs);
    for (const s of ["learner@example.test", "Ana", "secret-oauth-code", nonce, USER_ID]) expect(text).not.toContain(s);
  });
});

describe("callback: which learner's saved progress this browser uses", () => {
  const scopeCookie = (m: ReturnType<typeof makeRuntime>) => m.cookies.outgoing.get(cfg.cookieNames.scope);

  it("a returning learner's sign-in points the browser at THEIR progress: a readable, non-secret cookie holding only the account id", async () => {
    const { token, nonce } = flowToken(cfg, { intent: "signin" });
    const m = makeRuntime({ profile: "active" }, [{ name: cfg.cookieNames.flow, value: token }]);
    await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(scopeCookie(m)?.value).toBe(USER_ID);
    expect(scopeCookie(m)?.options).toMatchObject({ httpOnly: false, sameSite: "lax", path: "/" }); // script must read it; the session cookie stays httpOnly
    expect(scopeCookie(m)?.options.maxAge).toBeGreaterThan(0);
  });

  it("a new learner who joins is pointed at their own, empty progress", async () => {
    const { cookies, nonce } = jarWith();
    const m = makeRuntime({}, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("joined");
    expect(scopeCookie(m)?.value).toBe(USER_ID);
  });

  it("every refusal leaves the browser on whatever it had, and clears the hint when it ends the session", async () => {
    for (const over of [{ profile: "suspended" as const }, { redeem: "invalid" as const }, { exchangeOk: false }]) {
      const { cookies, nonce } = jarWith();
      const m = makeRuntime(over, [...cookies, { name: cfg.cookieNames.scope, value: USER_ID }]);
      await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
      const c = scopeCookie(m);
      expect(c === undefined || c.options.maxAge === 0, JSON.stringify(over)).toBe(true); // never SET for a refused sign-in
    }
  });

  it("signing out clears it", async () => {
    const { handleSignOut } = await import("./handlers");
    const m = makeRuntime({}, [{ name: cfg.cookieNames.auth, value: "s" }, { name: cfg.cookieNames.scope, value: USER_ID }]);
    await handleSignOut(m.rt, { headers: new Headers({ origin: cfg.siteUrl.origin }) });
    expect(scopeCookie(m)?.options.maxAge).toBe(0);
    expect(m.cookies.get(cfg.cookieNames.scope)).toBeUndefined();
  });
});
