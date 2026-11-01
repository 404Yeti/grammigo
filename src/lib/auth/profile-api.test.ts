// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listTopics } from "@/curriculum";
import { handleProfileGet, handleProfilePatch, type ProfileDeps } from "./profile-api";
import type { Viewer } from "./viewer";
import { testConfig, USER_ID } from "./testkit";

const config = testConfig();
const OTHER = "99999999-9999-4999-8999-999999999999";
const learner: Viewer = { kind: "learner", id: USER_ID, displayName: "Ana", isAdmin: false };
const topic = listTopics()[0];
const good = { displayName: "Ana M", firstLanguage: "Spanish", practising: [topic], dailyMinutes: 15 };

/** A stand-in for the learner's OWN Supabase client. It records every call so the tests can see exactly what was sent. */
function fakeClient(o: { select?: unknown; update?: unknown; updateError?: boolean } = {}) {
  const calls = { updates: [] as { table: string; row: Record<string, unknown> }[], eq: [] as [string, unknown][], from: [] as string[] };
  const builder = (result: unknown) => {
    const b = { select: () => b, eq: (c: string, v: unknown) => (calls.eq.push([c, v]), b), maybeSingle: async () => result };
    return b;
  };
  const row = { display_name: "Ana M", first_language: "Spanish", preferences: { v: 1, practising: [topic], dailyMinutes: 15 }, created_at: "2026-10-01T00:00:00Z" };
  const client = {
    from: (table: string) => {
      calls.from.push(table);
      return {
        select: () => builder({ data: o.select === undefined ? row : o.select, error: null }),
        update: (r: Record<string, unknown>) => (calls.updates.push({ table, row: r }), builder(o.updateError ? { data: null, error: { message: "boom" } } : { data: o.update === undefined ? { id: USER_ID } : o.update, error: null })),
      };
    },
    auth: { getUser: async () => ({ data: { user: { email: "ana@example.test" } } }) },
  };
  return { client: client as never, calls };
}
const limiter = (allowed = true) => ({ hit: async () => ({ allowed, retryAfter: 7 }) });
const headers = (extra: Record<string, string> = {}) => new Headers({ origin: config.siteUrl.origin, "x-real-ip": "203.0.113.1", ...extra });
const deps = (over: Partial<ProfileDeps> = {}, c = fakeClient()): ProfileDeps & { calls: typeof c.calls } => ({ config, viewer: learner, client: c.client, limiter: limiter(), headers: headers(), calls: c.calls, ...over });

describe("reading a profile", () => {
  it("returns the learner's own profile, including their email, from their own client", async () => {
    const d = deps();
    const r = await handleProfileGet(d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: "Ana M", firstLanguage: "Spanish", email: "ana@example.test", preferences: { dailyMinutes: 15 } });
    expect(d.calls.eq).toContainEqual(["id", USER_ID]);
  });
  it("401 without a session; 403 with a session but no active learner profile; never any data", async () => {
    const anon = await handleProfileGet(deps({ viewer: { kind: "anonymous" } }));
    expect([anon.status, anon.body]).toEqual([401, { error: "unauthenticated" }]);
    const none = await handleProfileGet(deps({ viewer: { kind: "no_profile" } }));
    expect([none.status, none.body]).toEqual([403, { error: "forbidden" }]);
  });
  it("403 if row-level security hides the row after all", async () => {
    expect((await handleProfileGet(deps({}, fakeClient({ select: null })))).status).toBe(403);
  });
});

describe("editing a profile", () => {
  it("updates ONLY the three allowed columns, for the verified learner's own row", async () => {
    const d = deps();
    const r = await handleProfilePatch(d, good);
    expect(r.status).toBe(200);
    expect(d.calls.updates).toHaveLength(1);
    expect(d.calls.updates[0].table).toBe("profiles");
    expect(Object.keys(d.calls.updates[0].row).sort()).toEqual(["display_name", "first_language", "preferences"]);
    expect(d.calls.eq).toContainEqual(["id", USER_ID]);
  });

  it("cannot be pointed at someone else: an id in the body is refused and nothing is written", async () => {
    for (const extra of [{ id: OTHER }, { userId: OTHER }, { user_id: OTHER }]) {
      const d = deps();
      const r = await handleProfilePatch(d, { ...good, ...extra });
      expect(r.status).toBe(400);
      expect(d.calls.updates).toEqual([]);
    }
  });

  it("cannot raise privileges or change protected fields", async () => {
    for (const extra of [{ status: "active" }, { adult_confirmed_at: "2000-01-01" }, { isAdmin: true }, { role: "admin" }]) {
      const d = deps();
      expect((await handleProfilePatch(d, { ...good, ...extra })).status).toBe(400);
      expect(d.calls.updates).toEqual([]);
    }
  });

  it("anonymous: 401; session without a learner profile: 403; nothing written", async () => {
    const a = deps({ viewer: { kind: "anonymous" } });
    expect((await handleProfilePatch(a, good)).status).toBe(401);
    const n = deps({ viewer: { kind: "no_profile" } });
    expect((await handleProfilePatch(n, good)).status).toBe(403);
    expect(a.calls.updates).toEqual([]);
    expect(n.calls.updates).toEqual([]);
  });

  it("refuses a cross-site request, and a request that proves nothing", async () => {
    for (const h of [headers({ origin: "https://evil.example" }), new Headers({ "x-real-ip": "1.1.1.1" }), new Headers({ "sec-fetch-site": "cross-site" })]) {
      const d = deps({ headers: h });
      expect((await handleProfilePatch(d, good)).status).toBe(403);
      expect(d.calls.updates).toEqual([]);
    }
  });

  it("refuses an oversized body, rate-limits with Retry-After, and FAILS CLOSED when the limiter is down", async () => {
    expect((await handleProfilePatch(deps({ headers: headers({ "content-length": "99999" }) }), good)).status).toBe(413);
    const limited = await handleProfilePatch(deps({ limiter: limiter(false) }), good);
    expect([limited.status, limited.retryAfter]).toEqual([429, 7]);
    const down = await handleProfilePatch(deps({ limiter: { hit: async () => { throw new Error("db"); } } }), good);
    expect(down.status).toBe(503);
  });

  it("returns field codes (never the submitted text) for invalid input", async () => {
    const d = deps();
    const r = await handleProfilePatch(d, { ...good, displayName: "<img src=x onerror=alert(1)>\u0000" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain("onerror");
    expect((r.body as { fields: Record<string, string> }).fields.displayName).toBe("name_invalid");
    expect(d.calls.updates).toEqual([]);
  });

  it("403 when row-level security matches no row, 500 on a database error; never a silent success", async () => {
    expect((await handleProfilePatch(deps({}, fakeClient({ update: null })), good)).status).toBe(403);
    expect((await handleProfilePatch(deps({}, fakeClient({ updateError: true })), good)).status).toBe(500);
  });
});
