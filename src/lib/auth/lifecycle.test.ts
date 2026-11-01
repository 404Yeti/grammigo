// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE_CONFIRM_PHRASE } from "./constants";
import { buildExport, handleDelete, handleExport, isRecentSignIn, latestAuthentication, ledgerHash, normaliseConfirmation, replayDeletionLedger, type LifecycleDeps, type ReplayDb } from "./lifecycle";
import { NOW, testConfig, USER_ID } from "./testkit";
import type { Viewer } from "./viewer";

const config = testConfig();
const OTHER = "99999999-9999-4999-8999-999999999999";
const learner: Viewer = { kind: "learner", id: USER_ID, displayName: "Ana", isAdmin: false };
const owner: Viewer = { kind: "learner", id: USER_ID, displayName: "Owner", isAdmin: true };
const fresh = Math.floor(NOW / 1000) - 30;

/** The learner's OWN client: it holds two people's rows and, like row-level security, answers only for the signed-in one. */
function ownClient(o: { fail?: "profile" | "documents" } = {}) {
  const asked: { table: string; filters: [string, unknown][] }[] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    profiles: [
      { id: USER_ID, display_name: "Ana", first_language: "Spanish", time_zone: "UTC", preferences: { v: 1 }, adult_confirmed_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
      { id: OTHER, display_name: "SECRET-OTHER-NAME", first_language: "x", time_zone: "x", preferences: {}, adult_confirmed_at: "x", created_at: "x", updated_at: "x" },
    ],
    consents: [
      { user_id: USER_ID, kind: "cloud_storage", version: "v1", accepted_at: "2026-10-03T00:00:00Z" },
      { user_id: OTHER, kind: "cloud_storage", version: "SECRET-OTHER", accepted_at: "x" },
    ],
    learner_documents: [
      { user_id: USER_ID, doc_key: "lessons_v2", schema_version: 2, revision: 3, updated_at: "2026-10-04T00:00:00Z", body: { version: 2, sessions: [{ id: "mine" }] } },
      { user_id: OTHER, doc_key: "lessons_v2", schema_version: 2, revision: 9, updated_at: "x", body: { version: 2, sessions: [{ id: "SECRET-OTHER-SESSION" }] } },
    ],
  };
  const client = {
    from: (table: string) => {
      const entry = { table, filters: [] as [string, unknown][] };
      asked.push(entry);
      let result = rows[table] ?? [];
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (entry.filters.push([c, v]), (result = result.filter((r) => r[c === "id" && table === "profiles" ? "id" : c] === v)), b),
        order: () => b,
        maybeSingle: async () => (o.fail === "profile" ? { data: null, error: { message: "x" } } : { data: result[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res(table === "learner_documents" && o.fail === "documents" ? { data: null, error: { message: "x" } } : { data: result, error: null }),
      };
      return b;
    },
    auth: { getUser: async () => ({ data: { user: { email: "ana@example.test" } } }) },
  };
  return { client: client as never, asked };
}

function serviceClient(o: { deleteError?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: null, error: fn === "delete_learner" && o.deleteError ? { message: "boom" } : null }) };
  return { service: service as never, calls };
}

const headers = (extra: Record<string, string> = {}) => new Headers({ origin: config.siteUrl.origin, "x-real-ip": "203.0.113.9", ...extra });
function deps(over: Partial<LifecycleDeps> = {}, o: { fail?: "profile" | "documents"; deleteError?: boolean } = {}) {
  const own = ownClient(o);
  const svc = serviceClient(o);
  const logs: string[] = [];
  let ended = 0;
  const d: LifecycleDeps = { config, viewer: learner, client: own.client, service: svc.service, limiter: { hit: async () => ({ allowed: true, retryAfter: 1 }) }, headers: headers(), signedInAt: fresh, now: () => NOW, log: (e, f) => void logs.push(`${e}:${JSON.stringify(f ?? {})}`), endSession: () => void ended++, ...over };
  return { d, own, svc, logs, ended: () => ended };
}

describe("export", () => {
  it("contains the signed-in learner's own records and NOTHING from anyone else's rows", async () => {
    const { d, own } = deps();
    const r = await handleExport(d);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/SECRET-OTHER/);
    expect(r.body).toMatchObject({
      format: "grammigo-account-export",
      account: { id: USER_ID, email: "ana@example.test" },
      profile: { displayName: "Ana", firstLanguage: "Spanish" },
      consents: [{ kind: "cloud_storage", version: "v1" }],
      progress: [{ document: "lessons_v2", revision: 3, body: { sessions: [{ id: "mine" }] } }],
    });
    // every read names the learner from the verified session
    for (const a of own.asked) expect(a.filters.every(([c, v]) => (c === "id" || c === "user_id") && v === USER_ID), a.table).toBe(true);
    expect(r.download?.filename).toBe("grammigo-my-data-2026-11-01.json");
  });

  it("uses the service role only to record that an export happened, with the learner's id and no content", async () => {
    const { d, svc } = deps();
    await handleExport(d);
    expect(svc.calls).toEqual([{ fn: "audit_export", args: { p_user: USER_ID } }]);
  });

  it("is refused for no session (401), an outage (503), a session with no learner profile (403) and a foreign origin (403), and reads nothing", async () => {
    for (const [viewer, status] of [[{ kind: "anonymous" }, 401], [{ kind: "unavailable" }, 503], [{ kind: "no_profile" }, 403]] as const) {
      const { d, own, svc } = deps({ viewer });
      expect((await handleExport(d)).status).toBe(status);
      expect(own.asked).toEqual([]);
      expect(svc.calls).toEqual([]);
    }
    const { d, own } = deps({ headers: headers({ origin: "https://evil.example" }) });
    expect((await handleExport(d)).status).toBe(403);
    expect(own.asked).toEqual([]);
    const sameSite = deps({ headers: new Headers({ "sec-fetch-site": "same-origin", "x-real-ip": "1.1.1.1" }) });
    expect((await handleExport(sameSite.d)).status).toBe(200);
    const crossSite = deps({ headers: new Headers({ "sec-fetch-site": "cross-site", "x-real-ip": "1.1.1.1" }) });
    expect((await handleExport(crossSite.d)).status).toBe(403);
  });

  it("is rate limited (429 with Retry-After) and fails CLOSED if the limiter is down", async () => {
    expect(await handleExport(deps({ limiter: { hit: async () => ({ allowed: false, retryAfter: 42 }) } }).d)).toMatchObject({ status: 429, retryAfter: 42 });
    const down = await handleExport(deps({ limiter: { hit: async () => { throw new Error("db"); } } }).d);
    expect(down.status).toBe(503);
  });

  it("answers 503 (not a half-empty download) if any part cannot be read", async () => {
    expect((await handleExport(deps({}, { fail: "profile" }).d)).status).toBe(503);
    expect((await handleExport(deps({}, { fail: "documents" }).d)).status).toBe(503);
  });

  it("is generated in memory per request, never logged: the log says only that an export happened", async () => {
    const { d, logs } = deps();
    const r = await handleExport(d);
    expect(r.status).toBe(200);
    expect(logs).toEqual(['export:{"outcome":"ok"}']);
    for (const l of logs) expect(l).not.toMatch(/Ana|ana@|mine|Spanish|2026|SECRET/);
  });

  it("carries no cache validators, and the response is marked as a download (the route adds no-store, nosniff and attachment)", async () => {
    const r = await handleExport(deps().d);
    expect(r.download?.filename).toMatch(/^grammigo-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(Object.keys(r)).not.toContain("etag");
  });

  it("states what it does NOT include", async () => {
    const out = await buildExport(deps().d, USER_ID);
    expect(out?.notIncluded.join(" ")).toMatch(/Earlier saved versions/);
    expect(out?.notIncluded.join(" ")).toMatch(/never receives your Google password/);
  });
});

describe("recent sign-in", () => {
  it("reads the newest authentication time from amr, ignoring junk", () => {
    expect(latestAuthentication([{ method: "oauth", timestamp: 100 }, { method: "password", timestamp: 250 }])).toBe(250);
    expect(latestAuthentication([{ method: "oauth" }, null, "x", { timestamp: "9" }, { timestamp: Number.NaN }])).toBeNull();
    expect(latestAuthentication(undefined)).toBeNull();
    expect(latestAuthentication(["oauth"])).toBeNull();
  });
  it("is recent only inside the window; unknown and future times are not recent", () => {
    const now = 1_000_000_000_000;
    const s = now / 1000;
    expect(isRecentSignIn(s - 5, now, 600)).toBe(true);
    expect(isRecentSignIn(s - 600, now, 600)).toBe(true);
    expect(isRecentSignIn(s - 601, now, 600)).toBe(false);
    expect(isRecentSignIn(null, now, 600)).toBe(false);
    expect(isRecentSignIn(s + 3_600, now, 600)).toBe(false); // a time in the future is a wrong clock, not a fresh sign-in
    expect(isRecentSignIn(s - 3, now, 1)).toBe(false);
  });
});

describe("delete", () => {
  const ok = { confirm: DELETE_CONFIRM_PHRASE };

  it("deletes through ONE database call that carries the keyed hash, then ends the browser session", async () => {
    const { d, svc, ended, logs } = deps();
    const r = await handleDelete(d, ok);
    expect(r).toMatchObject({ status: 200, body: { deleted: true } });
    expect(svc.calls).toHaveLength(1);
    expect(svc.calls[0].fn).toBe("delete_learner");
    expect(svc.calls[0].args.p_user).toBe(USER_ID);
    expect(svc.calls[0].args.p_user_hash).toBe(`\\x${ledgerHash(USER_ID, config.pepper).toString("hex")}`);
    expect(ended()).toBe(1);
    expect(logs.join(" ")).not.toMatch(new RegExp(`${USER_ID}|ana@|Ana`)); // the log says that it happened, never who
  });

  it("accepts the confirmation however it is cased or spaced, and nothing else", async () => {
    for (const c of ["Delete My Account", "  delete   my account  ", "DELETE MY ACCOUNT"]) expect((await handleDelete(deps().d, { confirm: c })).status, c).toBe(200);
    for (const c of ["delete", "delete my acount", "", "delete my account please", "Ana"]) {
      const { d, svc, ended } = deps();
      expect((await handleDelete(d, { confirm: c })).status, c).toBe(400);
      expect(svc.calls).toEqual([]);
      expect(ended()).toBe(0);
    }
    expect(normaliseConfirmation("  A  B ")).toBe("a b");
  });

  it("refuses anything but the exact body, and never takes an id from the request", async () => {
    for (const body of [null, undefined, "delete my account", [], {}, { confirm: 5 }, { confirm: DELETE_CONFIRM_PHRASE, userId: OTHER }, { confirm: DELETE_CONFIRM_PHRASE, id: OTHER }]) {
      const { d, svc } = deps();
      expect((await handleDelete(d, body)).status, JSON.stringify(body)).toBe(400);
      expect(svc.calls).toEqual([]);
    }
  });

  it("requires a RECENT sign-in: an old, unknown or future one is refused, and nothing is deleted", async () => {
    for (const signedInAt of [fresh - 3_600, null, Math.floor(NOW / 1000) + 7_200]) {
      const { d, svc, ended } = deps({ signedInAt });
      expect(await handleDelete(d, ok)).toMatchObject({ status: 403, body: { error: "reauth_required" } });
      expect(svc.calls).toEqual([]);
      expect(ended()).toBe(0);
    }
  });

  it("the window can be made stricter by configuration, but never longer than ten minutes", async () => {
    const strict = testConfig({ AUTH_REAUTH_WINDOW_SECONDS: "5" });
    expect(strict.reauthWindowSeconds).toBe(5);
    expect((await handleDelete(deps({ config: strict, signedInAt: Math.floor(NOW / 1000) - 30 }).d, ok)).status).toBe(403);
    for (const v of ["9999", "0", "-1", "abc", "1.5", ""]) expect(testConfig({ AUTH_REAUTH_WINDOW_SECONDS: v }).reauthWindowSeconds, v).toBe(600);
  });

  it("is refused for no session, an outage, a session without a learner profile, a foreign origin and an over-long body, and touches nothing", async () => {
    for (const [over, status] of [
      [{ viewer: { kind: "anonymous" } }, 401], [{ viewer: { kind: "unavailable" } }, 503], [{ viewer: { kind: "no_profile" } }, 403],
      [{ headers: headers({ origin: "https://evil.example" }) }, 403], [{ headers: headers({ "content-length": "5000" }) }, 413],
    ] as const) {
      const { d, svc, ended } = deps(over as Partial<LifecycleDeps>);
      expect((await handleDelete(d, ok)).status).toBe(status);
      expect(svc.calls).toEqual([]);
      expect(ended()).toBe(0);
    }
  });

  it("will not delete the owner through this path", async () => {
    const { d, svc } = deps({ viewer: owner });
    expect(await handleDelete(d, ok)).toMatchObject({ status: 409, body: { error: "owner_account" } });
    expect(svc.calls).toEqual([]);
  });

  it("is rate limited, and fails closed", async () => {
    expect((await handleDelete(deps({ limiter: { hit: async () => ({ allowed: false, retryAfter: 9 }) } }).d, ok)).status).toBe(429);
    expect((await handleDelete(deps({ limiter: { hit: async () => { throw new Error("db"); } } }).d, ok)).status).toBe(503);
  });

  it("if the database fails, the learner is NOT signed out and is told it failed (nothing half-done)", async () => {
    const { d, ended } = deps({}, { deleteError: true });
    expect(await handleDelete(d, ok)).toMatchObject({ status: 500, body: { error: "delete_failed" } });
    expect(ended()).toBe(0);
  });
});

describe("the deletion ledger's key", () => {
  it("is a keyed hash: stable, case-insensitive on the id, different per person and per key, and not the id", () => {
    const a = ledgerHash(USER_ID, config.pepper);
    expect(a).toHaveLength(32);
    expect(a.equals(ledgerHash(USER_ID.toUpperCase(), config.pepper))).toBe(true);
    expect(a.equals(ledgerHash(OTHER, config.pepper))).toBe(false);
    expect(a.equals(ledgerHash(USER_ID, Buffer.from("another-key-another-key-another-key")))).toBe(false);
    expect(a.toString("hex")).not.toContain(USER_ID.replaceAll("-", ""));
  });
});

describe("the operator script", () => {
  it("hashes exactly as the application does (a mismatch would silently delete nobody after a restore)", async () => {
    const { ledgerHash: script } = (await import("../../../scripts/replay-deletions.mjs")) as { ledgerHash: (id: string, pepper: string) => Buffer };
    const pepper = "x".repeat(40);
    for (const id of [USER_ID, OTHER, USER_ID.toUpperCase()]) expect(script(id, pepper).equals(ledgerHash(id, Buffer.from(pepper)))).toBe(true);
  });
  it("the suspended-request tool uses the same key, so its deletions are replayed after a restore too", async () => {
    const { ledgerHash: tool } = (await import("../../../scripts/suspended-requests.mjs")) as { ledgerHash: (id: string, pepper: string) => Buffer };
    const pepper = "x".repeat(40);
    for (const id of [USER_ID, OTHER]) expect(tool(id, pepper).equals(ledgerHash(id, Buffer.from(pepper)))).toBe(true);
  });
  it("dry run changes nothing; apply deletes the matches and reports owners it could not delete", async () => {
    const { replay } = (await import("../../../scripts/replay-deletions.mjs")) as { replay: (c: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, pepper: string, apply: boolean) => Promise<{ checked: number; ledger: number; matches: number; deleted: number }> };
    const pepper = "p".repeat(40);
    const present = new Set([USER_ID, OTHER]);
    const hashes = [ledgerHash(USER_ID, Buffer.from(pepper))];
    const client = {
      query: async (sql: string, p: unknown[] = []) => {
        if (sql.includes("all_user_ids")) return { rows: [...present].map((id) => ({ id })) };
        if (sql.includes("ledger_hashes")) return { rows: hashes.map((h) => ({ h })) };
        present.delete(String(p[0]));
        return { rows: [{ r: true }] };
      },
    };
    expect(await replay(client, pepper, false)).toEqual({ checked: 2, ledger: 1, matches: 1, deleted: 0 });
    expect(present.size).toBe(2);
    expect(await replay(client, pepper, true)).toEqual({ checked: 2, ledger: 1, matches: 1, deleted: 1 });
    expect([...present]).toEqual([OTHER]);
  });
});

describe("replaying the ledger after a restore", () => {
  function fakeDb(users: string[], ledger: Buffer[], owners: string[] = []) {
    const present = new Set(users);
    const deletedIds: string[] = [];
    const db: ReplayDb = {
      allUserIds: async () => [...present],
      ledgerHashes: async () => ledger,
      redelete: async (id) => (owners.includes(id) || !present.has(id) ? false : (present.delete(id), deletedIds.push(id), true)),
    };
    return { db, present, deletedIds };
  }
  it("deletes exactly the people in the ledger, leaves everyone else, and is idempotent", async () => {
    const [a, b, c] = [USER_ID, OTHER, "88888888-8888-4888-8888-888888888888"];
    const { db, present } = fakeDb([a, b, c], [ledgerHash(a, config.pepper), ledgerHash(c, config.pepper)]);
    expect(await replayDeletionLedger(db, config.pepper)).toEqual({ checked: 3, ledger: 2, deleted: 2 });
    expect([...present]).toEqual([b]);
    expect(await replayDeletionLedger(db, config.pepper)).toEqual({ checked: 1, ledger: 2, deleted: 0 });
  });
  it("with the WRONG key nothing is deleted (and the mismatch is visible: a ledger that matched nobody)", async () => {
    const { db, present } = fakeDb([USER_ID, OTHER], [ledgerHash(USER_ID, config.pepper)]);
    expect(await replayDeletionLedger(db, Buffer.from("not-the-right-key-not-the-right-key"))).toEqual({ checked: 2, ledger: 1, deleted: 0 });
    expect(present.size).toBe(2);
  });
  it("never deletes an owner, even one in the ledger", async () => {
    const { db, present } = fakeDb([USER_ID], [ledgerHash(USER_ID, config.pepper)], [USER_ID]);
    expect((await replayDeletionLedger(db, config.pepper)).deleted).toBe(0);
    expect(present.has(USER_ID)).toBe(true);
  });
});
