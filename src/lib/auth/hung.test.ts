// @vitest-environment node
import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthConfig } from "./config";
import { CookieSession } from "./cookie-session";
import { accountDb } from "./db";
import { handleExport } from "./lifecycle";
import { checkLimits, LIMITS } from "./rate-limit";
import { boundedTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "./timeout-fetch";
import { createServiceClient, createSessionClient } from "./supabase";
import { ENV, testConfig, USER_ID } from "./testkit";
import { getViewer } from "./viewer";

/**
 * A Supabase that ACCEPTS the connection and then says nothing (not "refused": hung). Real sockets, real clients, real timeout.
 */
let hole: Server;
const sockets = new Set<Socket>();
let port = 0;
beforeAll(async () => {
  hole = createServer((s) => {
    sockets.add(s);
    s.on("error", () => undefined);
  });
  await new Promise<void>((r) => hole.listen(0, "127.0.0.1", r));
  port = (hole.address() as { port: number }).port;
});
afterAll(async () => {
  sockets.forEach((s) => s.destroy());
  await new Promise<void>((r) => hole.close(() => r()));
});

const hung = (ms = 1_000) => testConfig({ SUPABASE_URL: `http://127.0.0.1:${port}`, AUTH_REQUEST_TIMEOUT_MS: String(ms) });
const sessionCookie = (cfg: ReturnType<typeof hung>) => {
  const s = { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER_ID, aud: "authenticated" } };
  return [{ name: cfg.cookieNames.auth, value: "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url") }];
};
const timed = async <T>(run: () => Promise<T>) => {
  const t0 = Date.now();
  const out = await run();
  return { out, ms: Date.now() - t0 };
};

describe("the timeout setting", () => {
  it("is bounded: 1 to 15 seconds, default 8, anything unreadable falls back to the default", () => {
    expect(boundedTimeoutMs(undefined)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(boundedTimeoutMs("")).toBe(8_000);
    expect(boundedTimeoutMs("3000")).toBe(3_000);
    expect(boundedTimeoutMs("1")).toBe(1_000);
    expect(boundedTimeoutMs("99999999")).toBe(15_000);
    expect(boundedTimeoutMs("-5")).toBe(1_000);
    for (const bad of ["abc", "1.5", "NaN", "Infinity", "1e3x"]) expect(boundedTimeoutMs(bad), bad).toBe(8_000);
  });
  it("reaches the account configuration, and an environment without it gets the default", () => {
    expect(testConfig({ AUTH_REQUEST_TIMEOUT_MS: "2500" }).requestTimeoutMs).toBe(2_500);
    expect(loadAuthConfig({ ...ENV }).state === "ready" && (loadAuthConfig({ ...ENV }) as { config: { requestTimeoutMs: number } }).config.requestTimeoutMs).toBe(8_000);
  });
});

describe("fetchWithTimeout", () => {
  it("abandons a request that never answers, and passes a normal one through untouched", async () => {
    const never: typeof fetch = (_i, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal?.reason)));
    const { out, ms } = await timed(() => fetchWithTimeout(60, never)("http://x").then(() => "answered", () => "gave up"));
    expect(out).toBe("gave up");
    expect(ms).toBeGreaterThanOrEqual(50);
    expect(ms).toBeLessThan(1_000);
    const ok: typeof fetch = async () => new Response("fine");
    expect(await (await fetchWithTimeout(60, ok)("http://x")).text()).toBe("fine");
  });
  it("still honours the caller's own abort", async () => {
    const never: typeof fetch = (_i, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal?.reason)));
    const c = new AbortController();
    const p = fetchWithTimeout(10_000, never)("http://x", { signal: c.signal }).then(() => "answered", () => "aborted");
    c.abort();
    expect(await p).toBe("aborted");
  });
});

describe("against a Supabase that hangs", () => {
  it("who is asking? 'unavailable' (never 'signed out'), after the timeout and not much later", async () => {
    const cfg = hung(1_000);
    const { out, ms } = await timed(() => getViewer(createSessionClient(cfg, new CookieSession(sessionCookie(cfg)))));
    expect(out).toEqual({ kind: "unavailable" });
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(4_000);
  });

  it("the service-role client returns an error instead of waiting, and the rate limiter fails CLOSED within the timeout", async () => {
    const cfg = hung(1_000);
    const svc = createServiceClient(cfg);
    const a = await timed(async () => await svc.rpc("anything"));
    expect(a.out.error).not.toBeNull();
    expect(a.ms).toBeLessThan(4_000);
    const b = await timed(() => checkLimits(accountDb(svc).limiter, cfg.flowSecret, LIMITS.export, "u").then(() => "allowed", () => "refused"));
    expect(b.out).toBe("refused");
    expect(b.ms).toBeLessThan(4_000);
  });

  it("an account handler answers 503 'try later' in about the timeout, and has changed nothing", async () => {
    const cfg = hung(1_000);
    const svc = createServiceClient(cfg);
    const own = createSessionClient(cfg, new CookieSession(sessionCookie(cfg)));
    const { out, ms } = await timed(() =>
      handleExport({ config: cfg, viewer: { kind: "learner", id: USER_ID, displayName: "Ana", isAdmin: false }, client: own, service: svc, limiter: accountDb(svc).limiter, headers: new Headers({ origin: cfg.siteUrl.origin }), signedInAt: null, now: () => Date.now(), log: () => undefined, endSession: () => undefined }),
    );
    expect(out.status).toBe(503);
    expect(ms).toBeLessThan(4_000);
  });

  it("without the timeout the same call would still be waiting (the test would be meaningless otherwise)", async () => {
    const raw = createServiceClient({ ...hung(1_000), requestTimeoutMs: 15_000 });
    const race = await Promise.race([raw.rpc("anything").then(() => "answered"), new Promise((r) => setTimeout(() => r("still waiting"), 1_500))]);
    expect(race).toBe("still waiting");
  });
});
