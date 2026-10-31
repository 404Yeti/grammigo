// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientAddress, bucketKey } from "./client-ip";
import { loadAuthConfig } from "./config";
import { FLOW_TTL_SECONDS, newNonce, safeEqual, signFlow, verifyFlow, type FlowPayload } from "./flow";
import { checkGoogleIdentity, displayNameFrom } from "./identity";
import { CODE_LENGTH, codeHint, formatCode, generateCode, hashCode, normaliseCode } from "./invite-code";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS, type RateLimitStore } from "./rate-limit";
import { safeNext } from "./safe-redirect";
import { ENV, googleUser, GRANT } from "./testkit";

describe("configuration", () => {
  it("is disabled unless the flag is exactly 'on' (so the default app has no account surface)", () => {
    expect(loadAuthConfig({}).state).toBe("disabled");
    expect(loadAuthConfig({ ...ENV, NEXT_PUBLIC_ACCOUNTS: "true" }).state).toBe("disabled");
    expect(loadAuthConfig({ ...ENV, NEXT_PUBLIC_ACCOUNTS: "ON" }).state).toBe("disabled");
    expect(loadAuthConfig({ ...ENV }).state).toBe("ready");
  });

  it.each([
    ["SUPABASE_URL", ""],
    ["SUPABASE_ANON_KEY", ""],
    ["SUPABASE_SERVICE_ROLE_KEY", ""],
    ["INVITE_CODE_PEPPER", "short"],
    ["AUTH_FLOW_SECRET", "short"],
    ["AUTH_SITE_URL", "not a url"],
    ["CRON_SECRET", "short"],
  ])("is misconfigured (never defaulted) when %s is missing or weak", (key, value) => {
    const s = loadAuthConfig({ ...ENV, [key]: value });
    expect(s.state).toBe("misconfigured");
  });

  it("refuses the same value for the pepper and the flow secret, and the same key for anon and service role", () => {
    expect(loadAuthConfig({ ...ENV, AUTH_FLOW_SECRET: ENV.INVITE_CODE_PEPPER }).state).toBe("misconfigured");
    expect(loadAuthConfig({ ...ENV, SUPABASE_ANON_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }).state).toBe("misconfigured");
  });

  it("requires https for any real site; http is allowed only for localhost", () => {
    expect(loadAuthConfig({ ...ENV, AUTH_SITE_URL: "http://grammigo.example" }).state).toBe("misconfigured");
    expect(loadAuthConfig({ ...ENV, AUTH_SITE_URL: "http://localhost:3100" }).state).toBe("ready");
  });

  it("uses Secure cookies with the __Host- prefix on https, and plain names on localhost", () => {
    const prod = loadAuthConfig({ ...ENV, AUTH_SITE_URL: "https://grammigo.example" });
    const dev = loadAuthConfig({ ...ENV });
    if (prod.state !== "ready" || dev.state !== "ready") throw new Error("not ready");
    expect(prod.config.secureCookies).toBe(true);
    expect(prod.config.cookieNames).toEqual({ auth: "__Host-gm-auth", flow: "__Host-gm-flow" });
    expect(dev.config.secureCookies).toBe(false);
    expect(dev.config.cookieNames.auth).toBe("gm-auth");
  });

  it("never reports a secret value, only the names of what is wrong", () => {
    const s = loadAuthConfig({ ...ENV, INVITE_CODE_PEPPER: "tiny-secret-value" });
    expect(JSON.stringify(s)).not.toContain("tiny-secret-value");
  });
});

describe("flow cookie", () => {
  const secret = Buffer.from("s".repeat(40));
  const now = 1_800_000_000;
  const base = (over: Partial<FlowPayload> = {}): FlowPayload => ({ v: 1, intent: "join", nonce: newNonce(), grant: GRANT, adultAt: "2026-11-01T00:00:00.000Z", exp: now + FLOW_TTL_SECONDS, ...over });

  it("round-trips a valid join and a valid sign-in", () => {
    const j = base();
    expect(verifyFlow(signFlow(j, secret), secret, now)).toEqual(j);
    const s: FlowPayload = { v: 1, intent: "signin", nonce: newNonce(), exp: now + 60 };
    expect(verifyFlow(signFlow(s, secret), secret, now)).toEqual(s);
  });

  it("rejects a forged signature, a tampered body, and a token signed with another secret", () => {
    const t = signFlow(base(), secret);
    const [body, sig] = t.split(".");
    const evil = Buffer.from(JSON.stringify({ ...base(), grant: "99999999-9999-4999-8999-999999999999" })).toString("base64url");
    expect(verifyFlow(`${evil}.${sig}`, secret, now)).toBeNull();
    expect(verifyFlow(`${body}.${sig.slice(0, -2)}AA`, secret, now)).toBeNull();
    expect(verifyFlow(t, Buffer.from("x".repeat(40)), now)).toBeNull();
  });

  it("rejects an expired cookie, including one at exactly its expiry second", () => {
    const t = signFlow(base({ exp: now + 10 }), secret);
    expect(verifyFlow(t, secret, now + 9)).not.toBeNull();
    expect(verifyFlow(t, secret, now + 10)).toBeNull();
    expect(verifyFlow(t, secret, now + 11)).toBeNull();
  });

  it("rejects malformed, oversized, empty and shape-violating tokens without throwing", () => {
    for (const bad of [undefined, null, "", "abc", "a.b.c", ".", "a.", ".b", "%%%.%%%", "x".repeat(5000), `${"a".repeat(10)}.${"b".repeat(10)}`]) {
      expect(verifyFlow(bad as string, secret, now)).toBeNull();
    }
    // validly signed but wrong shape: join with no grant, sign-in carrying a grant, an unknown field, a bad nonce
    expect(verifyFlow(signFlow(base({ grant: undefined }), secret), secret, now)).toBeNull();
    expect(verifyFlow(signFlow({ ...base(), intent: "signin" }, secret), secret, now)).toBeNull();
    expect(verifyFlow(signFlow({ ...base(), extra: 1 } as FlowPayload, secret), secret, now)).toBeNull();
    expect(verifyFlow(signFlow(base({ nonce: "short" }), secret), secret, now)).toBeNull();
  });

  it("compares nonces in constant time and only when equal", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("invitation codes", () => {
  it("generates the right length from the unambiguous alphabet, and does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]+$/); // no I, L, O, 0, 1
      seen.add(c);
    }
    expect(seen.size).toBe(500);
  });

  it("normalises what a person pastes, and rejects what cannot be a code", () => {
    const c = generateCode();
    expect(normaliseCode(formatCode(c))).toBe(c);
    expect(normaliseCode(` ${c.toLowerCase()} `)).toBe(c);
    for (const bad of ["", "short", c + "A", "O0O0O0O0O0O", "x".repeat(100), "ABCD EFGH IJ!", "'; drop table invitations;--"]) expect(normaliseCode(bad)).toBeNull();
    expect(normaliseCode(undefined as unknown as string)).toBeNull();
  });

  it("hashes with a keyed HMAC: stable for one pepper, different for another, and never the plain code", () => {
    const c = generateCode();
    const a = Buffer.from("a".repeat(40));
    const b = Buffer.from("b".repeat(40));
    expect(hashCode(c, a)).toEqual(hashCode(c, a));
    expect(hashCode(c, a)).not.toEqual(hashCode(c, b));
    expect(hashCode(c, a)).toHaveLength(32);
    expect(hashCode(c, a).toString("utf8")).not.toContain(c);
    expect(codeHint(c)).toBe(c.slice(-4));
  });
});

describe("safe redirect", () => {
  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/account/../../x/\\y", "javascript:alert(1)", "/\u0000", "/join", "/api/admin/invitations", "", "account"])(
    "refuses %j and falls back to /account",
    (raw) => expect(safeNext(raw)).toBe("/account"),
  );
  it("keeps allowed in-site paths", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/account/settings?tab=1")).toBe("/account/settings?tab=1");
  });
  it("treats null and over-long values as absent", () => {
    expect(safeNext(null)).toBe("/account");
    expect(safeNext("/account/" + "a".repeat(300))).toBe("/account");
  });
});

describe("origin check (cross-site request protection)", () => {
  const site = new URL("https://grammigo.example");
  it("accepts our own origin, and a same-origin fetch that carries no Origin", () => {
    expect(isTrustedOrigin(new Headers({ origin: "https://grammigo.example" }), site)).toBe(true);
    expect(isTrustedOrigin(new Headers({ "sec-fetch-site": "same-origin" }), site)).toBe(true);
  });
  it("refuses another site, a lookalike, a different port, an invalid Origin, and a request that proves nothing", () => {
    const refused: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://grammigo.example.evil.example" },
      { origin: "https://grammigo.example:8443" },
      { origin: "null" },
      { origin: "not a url" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      {},
    ];
    for (const h of refused) expect(isTrustedOrigin(new Headers(h), site), JSON.stringify(h)).toBe(false);
  });
  it("an Origin that is present wins over Sec-Fetch-Site", () => {
    expect(isTrustedOrigin(new Headers({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), site)).toBe(false);
  });
});

describe("client address and rate-limit keys", () => {
  it("prefers the platform headers over x-forwarded-for, which a client can extend", () => {
    expect(clientAddress(new Headers({ "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("1.1.1.1");
    expect(clientAddress(new Headers({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" }))).toBe("2.2.2.2");
    expect(clientAddress(new Headers({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("9.9.9.9");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
  it("keys are 32 bytes, keyed by secret, separated by namespace, and never contain the address", () => {
    const k = bucketKey(Buffer.from("s".repeat(40)), "join", "203.0.113.7");
    expect(k).toHaveLength(32);
    expect(k.toString("utf8")).not.toContain("203.0.113.7");
    expect(bucketKey(Buffer.from("s".repeat(40)), "signin", "203.0.113.7")).not.toEqual(k);
    expect(bucketKey(Buffer.from("t".repeat(40)), "join", "203.0.113.7")).not.toEqual(k);
  });
});

describe("rate-limit decisions", () => {
  const secret = Buffer.from("s".repeat(40));
  const storeWith = (responses: { allowed: boolean; retryAfter: number }[]): RateLimitStore & { hits: number } => {
    const s = { hits: 0, async hit() { return responses[s.hits++]; } };
    return s;
  };
  it("allows when every rule allows, and counts every rule", async () => {
    const s = storeWith([{ allowed: true, retryAfter: 1 }, { allowed: true, retryAfter: 1 }]);
    expect(await checkLimits(s, secret, LIMITS.join, "ip")).toEqual({ allowed: true });
    expect(s.hits).toBe(LIMITS.join.length);
  });
  it("refuses with the LONGEST wait when several rules refuse, but still counts all of them", async () => {
    const s = storeWith([{ allowed: false, retryAfter: 30 }, { allowed: false, retryAfter: 4000 }]);
    const d = await checkLimits(s, secret, LIMITS.join, "ip");
    expect(d).toEqual({ allowed: false, retryAfter: 4000, rule: "join:ip:day" });
    expect(s.hits).toBe(2);
  });
  it("propagates a store failure so callers can fail closed", async () => {
    await expect(checkLimits({ hit: async () => { throw new Error("db down"); } }, secret, LIMITS.join, "ip")).rejects.toThrow();
  });
});

describe("Google identity verification (and no automatic linking)", () => {
  it("accepts a verified, Google-only identity", () => expect(checkGoogleIdentity(googleUser())).toEqual({ ok: true }));

  it("refuses an unverified email, whichever signal says so", () => {
    expect(checkGoogleIdentity(googleUser({ identities: [{ provider: "google", identity_data: { email_verified: false } }] }))).toEqual({ ok: false, reason: "unverified" });
    expect(checkGoogleIdentity(googleUser({ identities: [{ provider: "google", identity_data: {} }] }))).toEqual({ ok: false, reason: "unverified" });
    expect(checkGoogleIdentity(googleUser({ email_confirmed_at: null }))).toEqual({ ok: false, reason: "unverified" });
    expect(checkGoogleIdentity(googleUser({ email: null }))).toEqual({ ok: false, reason: "unverified" });
  });

  it("refuses any other provider", () => {
    expect(checkGoogleIdentity(googleUser({ app_metadata: { provider: "email", providers: ["email"] }, identities: [{ provider: "email", identity_data: { email_verified: true } }] }))).toEqual({ ok: false, reason: "provider" });
    expect(checkGoogleIdentity(googleUser({ app_metadata: {} }))).toEqual({ ok: false, reason: "provider" });
  });

  it("refuses a Google identity that has been LINKED to an account with another sign-in method", () => {
    const linked = googleUser({
      app_metadata: { provider: "google", providers: ["email", "google"] },
      identities: [{ provider: "email", identity_data: { email_verified: true } }, { provider: "google", identity_data: { email_verified: true } }],
    });
    expect(checkGoogleIdentity(linked)).toEqual({ ok: false, reason: "linked" });
    // even if the metadata hides it, the identity list shows it
    expect(checkGoogleIdentity({ ...linked, app_metadata: { provider: "google", providers: ["google"] } })).toEqual({ ok: false, reason: "linked" });
  });

  it("builds a bounded, clean display name", () => {
    expect(displayNameFrom(googleUser())).toBe("Ana Pérez");
    expect(displayNameFrom(googleUser({ user_metadata: { full_name: "  A\u0000na \n\t Pérez  " } }))).toBe("Ana Pérez");
    expect(displayNameFrom(googleUser({ user_metadata: { full_name: "x".repeat(200) } }))).toHaveLength(40);
    expect(displayNameFrom(googleUser({ user_metadata: {} }))).toBe("learner");
    expect(displayNameFrom(googleUser({ user_metadata: {}, email: null }))).toBe("Learner");
  });
});
