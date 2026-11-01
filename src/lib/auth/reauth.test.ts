// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleCallback } from "./callback";
import { signFlow, verifyFlow, newNonce } from "./flow";
import { handleReauth } from "./handlers";
import { flowToken, googleUser, makeRuntime, NOW, postHeaders, testConfig, USER_ID } from "./testkit";

const cfg = testConfig();
const OTHER = "99999999-9999-4999-8999-999999999999";
const jar = (over: Parameters<typeof flowToken>[1] = {}) => {
  const { token, nonce } = flowToken(cfg, { intent: "reauth", uid: USER_ID, ...over });
  return { cookies: [{ name: cfg.cookieNames.flow, value: token }], nonce };
};

describe("starting a re-sign-in (POST /api/auth/reauth)", () => {
  it("sends an ACTIVE signed-in learner to Google with a flow cookie tied to their id", async () => {
    const m = makeRuntime({ profile: "active" });
    const r = await handleReauth(m.rt, { headers: postHeaders(cfg) });
    expect(r.status).toBe(303);
    expect(new URL((r as { location: string }).location).searchParams.get("provider")).toBe("google");
    const flow = verifyFlow(m.cookies.outgoing.get(cfg.cookieNames.flow)?.value, cfg.flowSecret, Math.floor(NOW / 1000));
    expect(flow).toMatchObject({ intent: "reauth", uid: USER_ID });
    expect(flow?.grant).toBeUndefined();
  });
  it("refuses a foreign origin, a signed-out visitor, and an account without an active profile, without starting anything", async () => {
    const evil = makeRuntime({ profile: "active" });
    expect((await handleReauth(evil.rt, { headers: new Headers({ origin: "https://evil.example" }) })).status).toBe(403);
    expect(evil.calls).not.toContain("startOAuth");
    for (const over of [{ user: null }, { profile: "none" as const }, { profile: "suspended" as const }]) {
      const m = makeRuntime({ profile: "active", ...over });
      const r = await handleReauth(m.rt, { headers: postHeaders(cfg) });
      expect(r).toMatchObject({ status: 303, location: "/signin?e=session" });
      expect(m.calls).not.toContain("startOAuth");
    }
  });
  it("is rate limited and fails closed", async () => {
    expect(await handleReauth(makeRuntime({ profile: "active", limiter: { allowed: false, retryAfter: 30 } }).rt, { headers: postHeaders(cfg) })).toMatchObject({ status: 303, location: "/account/delete?e=rate", retryAfter: 30 });
    expect(await handleReauth(makeRuntime({ profile: "active", limiter: "throw" }).rt, { headers: postHeaders(cfg) })).toMatchObject({ location: "/account/delete?e=server" });
  });
  it("if Google cannot be reached, the learner stays signed in and is told to try again", async () => {
    const m = makeRuntime({ profile: "active", startUrl: "throw" });
    expect(await handleReauth(m.rt, { headers: postHeaders(cfg) })).toMatchObject({ location: "/account/delete?e=server" });
    expect(m.calls).not.toContain("signOut");
  });
});

describe("the flow cookie for a re-sign-in", () => {
  const sign = (p: object) => signFlow({ v: 1, nonce: newNonce(), exp: Math.floor(NOW / 1000) + 600, ...p } as never, cfg.flowSecret);
  const read = (t: string) => verifyFlow(t, cfg.flowSecret, Math.floor(NOW / 1000));
  it("must name the learner, and must not carry an invitation", () => {
    expect(read(sign({ intent: "reauth", uid: USER_ID }))).not.toBeNull();
    expect(read(sign({ intent: "reauth" }))).toBeNull();
    expect(read(sign({ intent: "reauth", uid: USER_ID, grant: "11111111-1111-4111-8111-111111111111" }))).toBeNull();
    expect(read(sign({ intent: "reauth", uid: "not-a-uuid" }))).toBeNull();
  });
  it("a sign-in or a join must not carry a learner id", () => {
    expect(read(sign({ intent: "signin", uid: USER_ID }))).toBeNull();
    expect(read(sign({ intent: "join", uid: USER_ID, grant: "11111111-1111-4111-8111-111111111111", adultAt: "2026-11-01T00:00:00.000Z" }))).toBeNull();
  });
});

describe("the callback for a re-sign-in", () => {
  it("accepts the SAME learner and goes back to the delete page, without touching invitations", async () => {
    const { cookies, nonce } = jar();
    const m = makeRuntime({ profile: "active" }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/account/delete", outcome: "reauthenticated" });
    expect(m.calls.filter((c) => /redeem|reserve/.test(c))).toEqual([]);
    expect(m.calls).not.toContain("signOut");
  });
  it("refuses a DIFFERENT Google account: ends the new session and sends the learner to an error, with no deletion rights granted", async () => {
    const { cookies, nonce } = jar();
    const m = makeRuntime({ profile: "active", user: googleUser({ id: OTHER }) }, cookies);
    const r = await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce });
    expect(r).toEqual({ redirect: "/auth/error?r=reauth", outcome: "identity" });
    expect(m.calls).toContain("signOut");
  });
  it("refuses a Google account that has no learner profile (and cleans that identity up)", async () => {
    const { cookies, nonce } = jar({ uid: OTHER });
    const m = makeRuntime({ profile: "none", user: googleUser({ id: OTHER }) }, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("identity");
    expect(m.calls).toContain("purge");
  });
  it("a re-sign-in can never create an account, whatever the profile state", async () => {
    const { cookies, nonce } = jar();
    const m = makeRuntime({ profile: "none" }, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: nonce })).outcome).toBe("identity");
    expect(m.calls.filter((c) => c.startsWith("redeem"))).toEqual([]);
  });
  it("is single-use like every flow, and the URL nonce must match", async () => {
    const { cookies } = jar();
    const m = makeRuntime({ profile: "active" }, cookies);
    expect((await handleCallback(m.rt, { code: "abc", providerError: null, flowParam: newNonce() })).outcome).toBe("state");
    expect(m.calls).not.toContain("exchange");
  });
});
