import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSyncApi } from "./api-client";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, ok: status < 300, json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the network client turns every failure into a plain reason, and never throws", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [413, "too_large"],
    [422, "invalid"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [500, "unavailable"],
    [418, "other"],
  ])("a %s answer is '%s'", async (status, reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(status, { error: "x" })));
    expect(await fetchSyncApi().state()).toMatchObject({ ok: false, reason });
  });

  it("403 consent_required is its own reason (so saving stops and asks, instead of retrying)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(403, { error: "consent_required" })));
    expect(await fetchSyncApi().putDoc("lessons_v2", 0, {})).toMatchObject({ kind: "fail", reason: "consent_required" });
  });

  it("a refused connection or a dropped network is 'offline'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const api = fetchSyncApi();
    expect(await api.state()).toMatchObject({ ok: false, reason: "offline" });
    expect(await api.getDoc("guided_v1")).toMatchObject({ ok: false, reason: "offline" });
    expect(await api.putDoc("lessons_v2", 0, {})).toMatchObject({ kind: "fail", reason: "offline" });
    expect(await api.consent()).toMatchObject({ ok: false, reason: "offline" });
  });

  it("a request that never answers is cut off after 10 seconds, so nothing waits on a hung server", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))));
    const p = fetchSyncApi().state();
    await vi.advanceTimersByTimeAsync(9_900);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toMatchObject({ ok: false, reason: "offline" });
  });

  it("reads Retry-After, a conflict's current copy, and a missing document", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, { error: "rate_limited" }, { "retry-after": "42" })));
    expect(await fetchSyncApi().state()).toMatchObject({ reason: "rate_limited", retryAfter: 42 });
    vi.stubGlobal("fetch", vi.fn(async () => reply(409, { error: "conflict", revision: 7, body: { a: 1 } })));
    expect(await fetchSyncApi().putDoc("lessons_v2", 3, {})).toMatchObject({ kind: "conflict", revision: 7, body: { a: 1 } });
    vi.stubGlobal("fetch", vi.fn(async () => reply(404, { error: "not_found" })));
    expect(await fetchSyncApi().getDoc("lessons_v2")).toMatchObject({ ok: true, value: null });
  });

  it("sends only what the server needs: the revision it started from and the document; the account is never named", async () => {
    const f = vi.fn(async () => reply(200, { revision: 4 }));
    vi.stubGlobal("fetch", f);
    await fetchSyncApi().putDoc("lessons_v2", 3, { version: 2 }, { keepalive: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sync/documents/lessons_v2");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 3, body: { version: 2 } });
    expect(init.credentials).toBe("same-origin");
    expect(init.keepalive).toBe(true);
  });
});
