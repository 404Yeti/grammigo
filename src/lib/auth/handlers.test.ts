// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cronAuthorised, runCleanup } from "./cleanup";
import { callbackAllowed, handleJoin, handleSignIn, handleSignOut } from "./handlers";
import { generateCode } from "./invite-code";
import { isExpectedAuthorizeUrl } from "./start";
import { verifyFlow } from "./flow";
import { GRANT, makeRuntime, NOW, postHeaders, testConfig } from "./testkit";

const cfg = testConfig();
const code = generateCode();

describe("POST /api/auth/join", () => {
  it("reserves a seat, sets the signed single-use flow cookie, and sends the browser to Google with PKCE", async () => {
    const m = makeRuntime();
    const r = await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true });
    expect(r.status).toBe(303);
    const location = new URL((r as { location: string }).location);
    expect(location.origin).toBe(new URL(cfg.supabaseUrl).origin);
    expect(location.searchParams.get("provider")).toBe("google");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    const cookie = m.cookies.outgoing.get(cfg.cookieNames.flow);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 1800 });
    const flow = verifyFlow(cookie?.value, cfg.flowSecret, Math.floor(NOW / 1000));
    expect(flow).toMatchObject({ intent: "join", grant: GRANT });
    expect(location.searchParams.get("redirect_to")).toBe(`${cfg.siteUrl.origin}/api/auth/callback?flow=${flow?.nonce}`);
  });

  it("refuses a cross-site POST before touching the database", async () => {
    const m = makeRuntime();
    const r = await handleJoin(m.rt, { headers: new Headers({ origin: "https://evil.example" }), code, adult: true });
    expect(r.status).toBe(403);
    expect(m.calls).toEqual([]);
  });

  it("refuses an oversized body", async () => {
    const m = makeRuntime();
    expect((await handleJoin(m.rt, { headers: postHeaders(cfg, { "content-length": "999999" }), code, adult: true })).status).toBe(413);
    expect(m.calls).toEqual([]);
  });

  it("requires the 18+ confirmation and reserves nothing without it", async () => {
    const m = makeRuntime();
    expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: false })).toMatchObject({ location: "/join?e=adult" });
    expect(m.calls).not.toContain("reserve");
  });

  it("does not even query the database for a malformed code", async () => {
    const m = makeRuntime();
    for (const bad of ["", "abc", "x".repeat(60), "' or 1=1 --"]) {
      expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code: bad, adult: true })).toMatchObject({ location: "/join?e=invite" });
    }
    expect(m.calls).not.toContain("reserve");
  });

  it.each([
    ["invalid", "/join?e=invite"],
    ["expired", "/join?e=expired"],
    ["revoked", "/join?e=revoked"],
    ["full", "/join?e=full"],
  ] as const)("maps a %s code to its own message and starts no sign-in", async (error, location) => {
    const m = makeRuntime({ reserve: { error } });
    expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true })).toMatchObject({ status: 303, location });
    expect(m.calls).not.toContain("startOAuth");
    expect(m.cookies.get(cfg.cookieNames.flow)).toBeUndefined();
  });

  it("is rate limited BEFORE the invitation table is touched, with a Retry-After", async () => {
    const m = makeRuntime({ limiter: { allowed: false, retryAfter: 123 } });
    const r = await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true });
    expect(r).toMatchObject({ status: 303, location: "/join?e=rate", retryAfter: 123 });
    expect(m.calls).not.toContain("reserve");
  });

  it("FAILS CLOSED when the rate-limit store is down", async () => {
    const m = makeRuntime({ limiter: "throw" });
    expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true })).toMatchObject({ location: "/join?e=server" });
    expect(m.calls).not.toContain("reserve");
  });

  it("gives the seat back and sets no cookie if Google sign-in cannot be started safely", async () => {
    for (const startUrl of ["https://evil.example/x", "throw" as const, "https://evil.example/auth/v1/authorize?provider=google"]) {
      const m = makeRuntime({ startUrl });
      expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true })).toMatchObject({ location: "/join?e=server" });
      expect(m.calls).toContain("release");
      expect(m.cookies.get(cfg.cookieNames.flow)).toBeUndefined(); // nothing is left set (a deletion entry is fine)
    }
  });

  it("if the database fails while reserving, nothing is started", async () => {
    const m = makeRuntime({ reserve: "throw" });
    expect(await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true })).toMatchObject({ location: "/join?e=server" });
    expect(m.calls).not.toContain("startOAuth");
  });

  it("logs outcomes without the code or the address", async () => {
    const m = makeRuntime({ reserve: { error: "invalid" } });
    await handleJoin(m.rt, { headers: postHeaders(cfg), code, adult: true });
    const text = JSON.stringify(m.logs);
    expect(text).not.toContain(code);
    expect(text).not.toContain("203.0.113.7");
  });
});

describe("POST /api/auth/signin", () => {
  it("starts a sign-in flow that carries NO invitation", async () => {
    const m = makeRuntime();
    const r = await handleSignIn(m.rt, { headers: postHeaders(cfg) });
    expect(r.status).toBe(303);
    const flow = verifyFlow(m.cookies.outgoing.get(cfg.cookieNames.flow)?.value, cfg.flowSecret, Math.floor(NOW / 1000));
    expect(flow?.intent).toBe("signin");
    expect(flow?.grant).toBeUndefined();
    expect(m.calls).not.toContain("reserve");
  });
  it("refuses cross-site posts, rate limits, and fails closed", async () => {
    expect((await handleSignIn(makeRuntime().rt, { headers: new Headers({ origin: "https://evil.example" }) })).status).toBe(403);
    expect(await handleSignIn(makeRuntime({ limiter: { allowed: false, retryAfter: 9 } }).rt, { headers: postHeaders(cfg) })).toMatchObject({ location: "/signin?e=rate", retryAfter: 9 });
    expect(await handleSignIn(makeRuntime({ limiter: "throw" }).rt, { headers: postHeaders(cfg) })).toMatchObject({ location: "/signin?e=server" });
  });
});

describe("POST /api/auth/signout", () => {
  it("clears every account cookie even if the Auth server cannot be reached", async () => {
    const m = makeRuntime({ signOut: "throw" }, [{ name: cfg.cookieNames.auth, value: "s" }]);
    expect(await handleSignOut(m.rt, { headers: postHeaders(cfg) })).toMatchObject({ status: 303, location: "/" });
    expect(m.cookies.outgoing.get(cfg.cookieNames.auth)?.options.maxAge).toBe(0);
  });
  it("cannot be triggered cross-site (no logout CSRF)", async () => {
    const m = makeRuntime({}, [{ name: cfg.cookieNames.auth, value: "s" }]);
    expect((await handleSignOut(m.rt, { headers: new Headers({ origin: "https://evil.example" }) })).status).toBe(403);
    expect(m.calls).not.toContain("signOut");
  });
});

describe("callback rate limit", () => {
  it("allows, refuses with a wait, and fails closed", async () => {
    expect(await callbackAllowed(makeRuntime().rt, new Headers())).toEqual({ allowed: true });
    expect(await callbackAllowed(makeRuntime({ limiter: { allowed: false, retryAfter: 7 } }).rt, new Headers())).toEqual({ allowed: false, retryAfter: 7 });
    expect((await callbackAllowed(makeRuntime({ limiter: "throw" }).rt, new Headers())).allowed).toBe(false);
  });
});

describe("the authorize URL is verified before the browser is sent anywhere", () => {
  const base = cfg.supabaseUrl;
  const redirect = `${cfg.siteUrl.origin}/api/auth/callback?flow=abc`;
  const good = `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${"x".repeat(43)}&code_challenge_method=s256`;
  it("accepts the expected URL", () => expect(isExpectedAuthorizeUrl(good, base, redirect)).toBe(true));
  it.each([
    ["another host", good.replace("127.0.0.1:54321", "evil.example")],
    ["a different provider", good.replace("provider=google", "provider=github")],
    ["no PKCE challenge", good.replace(/&code_challenge=x+/, "")],
    ["a plain (non-S256) challenge method", good.replace("s256", "plain")],
    ["a different redirect_to", good.replace(encodeURIComponent(redirect), encodeURIComponent("https://evil.example/cb"))],
    ["not a URL", "javascript:alert(1)"],
  ])("rejects %s", (_n, url) => expect(isExpectedAuthorizeUrl(url, base, redirect)).toBe(false));
});

describe("scheduled cleanup", () => {
  it("authorises only the exact bearer secret, and nothing when no secret is configured", () => {
    const secret = "c".repeat(40);
    expect(cronAuthorised(`Bearer ${secret}`, secret)).toBe(true);
    for (const h of [null, "", "Bearer ", `Bearer ${secret}x`, `bearer ${secret}`, secret, "Basic abc"]) expect(cronAuthorised(h, secret)).toBe(false);
    expect(cronAuthorised(`Bearer ${secret}`, null)).toBe(false);
    expect(cronAuthorised("Bearer ", "")).toBe(false);
  });

  it("runs every step even when one fails, and reports which failed", async () => {
    const calls: string[] = [];
    const service = { rpc: async (name: string) => { calls.push(name); return name === "purge_orphan_identities" ? { data: null, error: { message: "boom" } } : { data: 3, error: null }; } };
    const report = await runCleanup(service as never);
    expect(calls).toEqual(["release_expired_reservations", "purge_orphan_identities", "prune_rate_limits"]);
    expect(report).toEqual({ released: 3, purged: null, pruned: 3, failed: ["purge_orphan_identities"] });
  });
});
