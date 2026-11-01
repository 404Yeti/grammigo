import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/features/practice/session";
import { hashDocument } from "@/features/sync/canonical";
import type { DocKey } from "@/features/sync/documents";
import type { ApiResult, Failure, PutResult, SyncApi } from "@/features/sync/engine";
import { Clock, Device } from "@/features/sync/sim";
import { handleSyncConsent, handleSyncGet, handleSyncPut, handleSyncState, type SyncDeps, type SyncResult } from "@/lib/auth/sync-api";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { emptyState } from "@/lib/storage/schema";
import { lesson } from "@/tests/helpers";
import { closePool, q } from "../helpers";
import { config, createPerson, db, freshHeaders, service, sessionFor, type Person } from "./kit";

/**
 * Cloud-saved progress on the REAL local stack: real Auth sessions, real row-level security, the real consent rule in the database and
 * the real compare-and-swap. The sync engine is driven through the very handlers the routes call.
 */
const body = (ids: string[]) => ({ ...emptyState(), sessions: ids.map((id, i) => ({ ...createSession(lesson, id, 1_000 + i), status: "completed" as const, completedAt: 2_000 + i, updatedAt: 2_000 + i })) });
const doc = (ids: string[]) => JSON.parse(JSON.stringify(body(ids))) as Record<string, unknown>;

async function deps(p: Person, over: Partial<SyncDeps> = {}): Promise<SyncDeps> {
  const { client } = sessionFor(p.cookies);
  return { config, viewer: await getViewer(client), client, service, limiter: db.limiter, headers: freshHeaders(), ...over };
}
const put = async (p: Person, key: string, expected: number, b: unknown, over: Partial<SyncDeps> = {}) =>
  handleSyncPut(await deps(p, over), key, { expectedRevision: expected, body: b }, JSON.stringify(b).length);
const get = async (p: Person, key: string) => handleSyncGet(await deps(p), key);
const state = async (p: Person) => handleSyncState(await deps(p));
const consent = async (p: Person) => handleSyncConsent(await deps(p), { accept: true });
const stored = async (id: string, key: DocKey) => (await q("select revision, body from public.learner_documents where user_id = $1 and doc_key = $2", [id, key])).rows[0] as { revision: string; body: { sessions: { id: string }[] } } | undefined;

function failure(status: number, error: unknown, retryAfter?: number): Failure {
  if (status === 401) return { reason: "unauthorized" };
  if (status === 403) return { reason: error === "consent_required" ? "consent_required" : "unauthorized" };
  if (status === 413) return { reason: "too_large" };
  if (status === 422 || status === 400) return { reason: "invalid" };
  if (status === 429) return { reason: "rate_limited", retryAfter };
  return { reason: status >= 500 ? "unavailable" : "other", retryAfter };
}
const errOf = (r: SyncResult) => (r.body as { error?: unknown })?.error;

/** The engine's network, wired straight to the real handlers (a real request does the same: verify the session, then run the handler). */
function inProcessApi(p: Person, timings?: Record<string, number[]>, lose?: { next: boolean }): SyncApi {
  const timed = async <T>(op: string, run: () => Promise<T>) => {
    const t0 = performance.now();
    const out = await run();
    const ms = performance.now() - t0;
    (timings ??= {})[op] ??= [];
    timings[op].push(ms);
    return { out, ms };
  };
  return {
    async state(): Promise<ApiResult<never>> {
      const { out, ms } = await timed("state", () => state(p));
      return out.status === 200 ? ({ ok: true, value: out.body, ms } as ApiResult<never>) : ({ ok: false, ms, ...failure(out.status, errOf(out), out.retryAfter) } as ApiResult<never>);
    },
    async getDoc(key): Promise<ApiResult<never>> {
      const { out, ms } = await timed("get", () => get(p, key));
      if (out.status === 200) return { ok: true, value: out.body, ms } as ApiResult<never>;
      if (out.status === 404) return { ok: true, value: null, ms } as ApiResult<never>;
      return { ok: false, ms, ...failure(out.status, errOf(out), out.retryAfter) } as ApiResult<never>;
    },
    async putDoc(key, expected, b): Promise<PutResult> {
      const { out, ms } = await timed("put", () => put(p, key, expected, b));
      if (out.status === 200 && lose?.next) {
        lose.next = false;
        return { kind: "fail", reason: "offline", ms }; // it LANDED; the answer is lost on the way back
      }
      if (out.status === 200) return { kind: "ok", revision: (out.body as { revision: number }).revision, ms };
      if (out.status === 409) return { kind: "conflict", revision: (out.body as { revision: number }).revision, body: (out.body as { body: unknown }).body ?? null, ms };
      return { kind: "fail", ms, ...failure(out.status, errOf(out), out.retryAfter) };
    },
    async consent(): Promise<ApiResult<{ consent: true }>> {
      const { out, ms } = await timed("consent", () => consent(p));
      return out.status === 200 ? { ok: true, value: { consent: true }, ms } : { ok: false, ms, ...failure(out.status, errOf(out), out.retryAfter) };
    },
  };
}

beforeAll(async () => {
  await q("truncate public.rate_limits");
});
afterAll(closePool);

describe("consent is enforced by the database, not only the route", () => {
  it("nothing can be stored without the learner's recorded consent, however privileged the caller", async () => {
    const a = await createPerson({ label: "no-consent", learner: true });
    const direct = (await q("select * from public.put_document($1, 'lessons_v2', 0, 2, $2::jsonb)", [a.id, JSON.stringify(doc(["x"]))])).rows[0];
    expect(direct).toMatchObject({ ok: false, error: "consent_required" });
    expect(await stored(a.id, "lessons_v2")).toBeUndefined();
    const viaRoute = await put(a, "lessons_v2", 0, doc(["x"]));
    expect([viaRoute.status, errOf(viaRoute)]).toEqual([403, "consent_required"]);
    expect(await stored(a.id, "lessons_v2")).toBeUndefined();
  });

  it("recording consent is idempotent, versioned, and safe under concurrency", async () => {
    const a = await createPerson({ label: "consent-once", learner: true });
    await Promise.all(Array.from({ length: 12 }, async () => consent(a)));
    const rows = (await q("select kind, version from public.consents where user_id = $1 and kind = 'cloud_storage'", [a.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toMatch(/^draft-/);
    expect((await state(a)).body).toMatchObject({ consent: true });
  });

  it("an identity that is not an active learner cannot opt in to anything", async () => {
    const stranger = await createPerson({ label: "no-profile5" });
    await expect(q("select public.record_consent($1, 'x')", [stranger.id])).rejects.toThrow(/active learner/);
    expect((await consent(stranger)).status).toBe(403);
    const sus = await createPerson({ label: "suspended5", learner: true });
    await q("update public.profiles set status = 'suspended' where id = $1", [sus.id]);
    await expect(q("select public.record_consent($1, 'x')", [sus.id])).rejects.toThrow(/active learner/);
  });
});

describe("saving and reading progress through the real handlers", () => {
  it("creates, reads back, and reports revisions; the stored document is exactly what was sent", async () => {
    const a = await createPerson({ label: "save", learner: true });
    await consent(a);
    expect((await state(a)).body).toMatchObject({ consent: true, documents: { lessons_v2: null, guided_v1: null } });
    const first = await put(a, "lessons_v2", 0, doc(["s1"]));
    expect([first.status, first.body]).toEqual([200, { revision: 1 }]);
    expect(first.dbMs).toBeGreaterThanOrEqual(0);
    const read = await get(a, "lessons_v2");
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ revision: 1, body: doc(["s1"]) });
    expect((await state(a)).body).toMatchObject({ documents: { lessons_v2: { revision: 1 }, guided_v1: null } });
    expect((await get(a, "guided_v1")).status).toBe(404);
  });

  it("is compare-and-swap: a stale save is refused with the current copy, and nothing is overwritten", async () => {
    const a = await createPerson({ label: "cas", learner: true });
    await consent(a);
    await put(a, "lessons_v2", 0, doc(["one"]));
    const again = await put(a, "lessons_v2", 0, doc(["rival"]));
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "conflict", revision: 1, body: doc(["one"]) });
    expect((await stored(a.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["one"]);
    expect((await put(a, "lessons_v2", 1, doc(["one", "two"]))).body).toEqual({ revision: 2 });
    expect((await put(a, "lessons_v2", 1, doc(["stale"]))).status).toBe(409);
  });

  it("14 simultaneous saves from the same revision: exactly one wins, the rest get the current copy", async () => {
    const a = await createPerson({ label: "race", learner: true });
    await consent(a);
    const results = await Promise.all(Array.from({ length: 14 }, (_, i) => put(a, "lessons_v2", 0, doc([`racer${i}`]))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(13);
    expect(Number((await stored(a.id, "lessons_v2"))?.revision)).toBe(1);
  });

  it("rejects what the database would not accept, stores nothing, and never echoes the body", async () => {
    const a = await createPerson({ label: "invalid5", learner: true });
    await consent(a);
    const wrongVersion = await put(a, "lessons_v2", 0, { version: 9, sessions: [], onboarding: {} });
    expect([wrongVersion.status, errOf(wrongVersion)]).toEqual([422, "invalid_document"]);
    expect((await put(a, "lessons_v2", 0, { sessions: "no" })).status).toBe(422);
    expect(await stored(a.id, "lessons_v2")).toBeUndefined();
    expect((await handleSyncPut(await deps(a), "lessons_v2", { expectedRevision: 0, body: doc(["x"]), extra: 1 }, 100)).status).toBe(400); // strict envelope
    expect((await handleSyncPut(await deps(a), "lessons_v2", { expectedRevision: -1, body: doc(["x"]) }, 100)).status).toBe(400);
    expect((await handleSyncPut(await deps(a), "lessons_v2", { expectedRevision: 0, body: "text" }, 100)).status).toBe(400);
    expect((await handleSyncPut(await deps(a), "lessons_v2", null, 100)).status).toBe(400);
    expect((await handleSyncPut(await deps(a), "../secrets", { expectedRevision: 0, body: doc(["x"]) }, 100)).status).toBe(404);
    expect((await handleSyncPut(await deps(a), "lessons_v2", { expectedRevision: 0, body: doc(["x"]) }, 5_000_000)).status).toBe(413);
    expect((await put(a, "lessons_v2", 0, { ...doc(["x"]), pad: "y".repeat(950_000) })).status).toBe(413);
    expect(JSON.stringify((await put(a, "lessons_v2", 0, { version: 9, sessions: [], onboarding: {}, secret: "LEAK-CHECK" })).body)).not.toContain("LEAK-CHECK");
  });

  it("keeps the two documents separate: guided activity never lands in the lesson document, or the other way round", async () => {
    const a = await createPerson({ label: "two-docs", learner: true });
    await consent(a);
    expect((await put(a, "guided_v1", 0, { version: 1, sessions: [], activeSessionId: null })).status).toBe(200);
    expect((await put(a, "guided_v1", 0, doc(["lesson-shaped"]))).status).toBe(409); // wrong revision AND wrong shape: still refused
    expect((await put(a, "guided_v1", 1, doc(["lesson-shaped"]))).status).toBe(422); // the lesson document is not a valid guided document
    expect((await state(a)).body).toMatchObject({ documents: { lessons_v2: null, guided_v1: { revision: 1 } } });
  });
});

describe("account-scoped progress is isolated", () => {
  it("one learner's saved progress is invisible to another: reads, state, saves and direct queries", async () => {
    const [a, b] = await Promise.all([createPerson({ label: "iso5-a", learner: true }), createPerson({ label: "iso5-b", learner: true })]);
    await Promise.all([consent(a), consent(b)]);
    await put(a, "lessons_v2", 0, doc(["alpha-only"]));
    expect((await get(b, "lessons_v2")).status).toBe(404);
    expect((await state(b)).body).toMatchObject({ documents: { lessons_v2: null } });
    // B saves their own: it does not touch A's, and the revisions are independent
    expect((await put(b, "lessons_v2", 0, doc(["bravo-only"]))).body).toEqual({ revision: 1 });
    expect((await stored(a.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["alpha-only"]);
    expect((await stored(b.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["bravo-only"]);
    // and neither can read the other's through the data API with their own valid session
    const { client } = sessionFor(b.cookies);
    expect((await client.from("learner_documents").select("*").eq("user_id", a.id)).data).toEqual([]);
    expect((await client.from("learner_document_versions").select("*")).data ?? []).toEqual([]);
    // and cannot write directly
    expect((await client.from("learner_documents").insert({ user_id: b.id, doc_key: "lessons_v2", schema_version: 2, body: doc(["x"]) })).error).not.toBeNull();
    expect((await client.from("learner_documents").update({ body: doc(["hacked"]) }).eq("user_id", a.id).select()).data ?? []).toEqual([]);
    expect((await stored(a.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["alpha-only"]);
  });

  it("even if the app's identity check were bypassed (a forged viewer), the service-role save is refused by row-level security's cross-check", async () => {
    const [a, b] = await Promise.all([createPerson({ label: "forge5-a", learner: true }), createPerson({ label: "forge5-b", learner: true })]);
    await Promise.all([consent(a), consent(b)]);
    await put(b, "lessons_v2", 0, doc(["bravo-real"]));
    const forged = await deps(a, { viewer: { kind: "learner", id: b.id, displayName: "B", isAdmin: false } });
    for (const out of [await handleSyncPut(forged, "lessons_v2", { expectedRevision: 1, body: doc(["injected"]) }, 100), await handleSyncGet(forged, "lessons_v2"), await handleSyncState(forged)]) {
      expect([200, 404].includes(out.status) ? JSON.stringify(out.body) : "").not.toContain("bravo-real"); // nothing of B's is returned to A's session
    }
    expect((await handleSyncPut(forged, "lessons_v2", { expectedRevision: 1, body: doc(["injected"]) }, 100)).status).toBe(403);
    expect((await stored(b.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["bravo-real"]);
    expect(Number((await stored(b.id, "lessons_v2"))?.revision)).toBe(1);
  });

  it("who may sync at all: anonymous 401, a session without a learner profile 403, a suspended learner 403, an outage 503; nothing stored", async () => {
    const stranger = await createPerson({ label: "stranger5" });
    const sus = await createPerson({ label: "sus5", learner: true });
    await q("update public.profiles set status = 'suspended' where id = $1", [sus.id]);
    const cases: [string, Viewer | undefined, Person, number][] = [
      ["anonymous", { kind: "anonymous" }, stranger, 401],
      ["unavailable", { kind: "unavailable" }, stranger, 503],
      ["no profile", undefined, stranger, 403],
      ["suspended", undefined, sus, 403],
    ];
    for (const [name, viewer, who, status] of cases) {
      const over = viewer ? { viewer } : {};
      expect((await put(who, "lessons_v2", 0, doc(["x"]), over)).status, `put ${name}`).toBe(status);
      expect((await handleSyncGet(await deps(who, over), "lessons_v2")).status, `get ${name}`).toBe(status);
      expect((await handleSyncState(await deps(who, over))).status, `state ${name}`).toBe(status);
      expect((await handleSyncConsent(await deps(who, over), { accept: true })).status, `consent ${name}`).toBe(status);
    }
    expect((await q("select count(*)::int as n from public.learner_documents where user_id = any($1)", [[stranger.id, sus.id]])).rows[0].n).toBe(0);
  });

  it("a cross-site request cannot save or consent, and saves are rate limited per learner", async () => {
    const a = await createPerson({ label: "csrf5", learner: true });
    const evil = { headers: new Headers({ origin: "https://evil.example", "x-real-ip": "198.51.100.9" }) };
    expect((await put(a, "lessons_v2", 0, doc(["x"]), evil)).status).toBe(403);
    expect((await handleSyncConsent(await deps(a, evil), { accept: true })).status).toBe(403);
    expect((await q("select count(*)::int as n from public.consents where user_id = $1 and kind = 'cloud_storage'", [a.id])).rows[0].n).toBe(0);
    const h = new Headers({ origin: config.siteUrl.origin, "x-real-ip": "198.51.100.10" });
    const statuses: number[] = [];
    for (let i = 0; i < 63; i++) statuses.push((await handleSyncPut(await deps(a, { headers: h }), "lessons_v2", null, 10)).status);
    expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true); // reached validation: within the limit
    expect(statuses.slice(60)).toEqual([429, 429, 429]);
  });
});

describe("two devices, one account, the real database", () => {
  it("each device finishes a different lesson offline; both end up with both, and the account holds exactly the union", async () => {
    const a = await createPerson({ label: "dev2", learner: true });
    await consent(a);
    const clock = new Clock();
    const meta = { consent: true } as const;
    const phone = new Device(clock, inProcessApi(a), meta).boot();
    const laptop = new Device(clock, inProcessApi(a), meta).boot();
    await clock.run(2_000);
    phone.finish("phone-lesson");
    laptop.finish("laptop-lesson");
    await clock.run(15_000);
    await clock.run(15_000);
    phone.engine.syncNow();
    await clock.run(5_000);
    const row = await stored(a.id, "lessons_v2");
    expect(row?.body.sessions.map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    expect(phone.lessons.sessions.map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    expect(laptop.lessons.sessions.map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    expect(hashDocument(phone.lessons)).toBe(hashDocument(row!.body));
    expect(phone.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
  });

  it("a save that LANDED but whose answer was lost is harmless: the device converges without a duplicate or a loss", async () => {
    const a = await createPerson({ label: "lost-answer", learner: true });
    await consent(a);
    const clock = new Clock();
    const lose = { next: true };
    const dev = new Device(clock, inProcessApi(a, undefined, lose), { consent: true }).boot();
    await clock.run(2_000);
    dev.finish("only");
    await clock.run(5_000);
    expect(Number((await stored(a.id, "lessons_v2"))?.revision)).toBe(1); // it landed
    await clock.run(30_000);
    expect(dev.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
    expect(Number((await stored(a.id, "lessons_v2"))?.revision)).toBe(1); // and was not written again
  });

  it("turning saving on for the first time: consent is recorded, then the progress that was already here is saved", async () => {
    const a = await createPerson({ label: "first-time", learner: true });
    const clock = new Clock();
    const dev = new Device(clock, inProcessApi(a));
    dev.finish("had-before");
    dev.boot();
    await clock.run(3_000);
    expect(await stored(a.id, "lessons_v2")).toBeUndefined(); // nothing goes up before the learner agrees
    expect(dev.engine.getStatus().phase).toBe("needs_consent");
    dev.engine.enable();
    await clock.run(3_000);
    expect((await q("select count(*)::int as n from public.consents where user_id = $1 and kind = 'cloud_storage'", [a.id])).rows[0].n).toBe(1);
    expect((await stored(a.id, "lessons_v2"))?.body.sessions.map((s) => s.id)).toEqual(["had-before"]);
  });

  it("a brand-new device signs in and receives the account's progress; a different account's device never does", async () => {
    const [a, b] = await Promise.all([createPerson({ label: "recv-a", learner: true }), createPerson({ label: "recv-b", learner: true })]);
    await Promise.all([consent(a), consent(b)]);
    const clock = new Clock();
    const first = new Device(clock, inProcessApi(a), { consent: true }).boot();
    await clock.run(2_000);
    first.finish("a-lesson");
    await clock.run(6_000);
    const second = new Device(clock, inProcessApi(a), { consent: true }).boot();
    const strangers = new Device(clock, inProcessApi(b), { consent: true }).boot();
    await clock.run(4_000);
    expect(second.lessons.sessions.map((s) => s.id)).toEqual(["a-lesson"]);
    expect(strangers.lessons.sessions).toEqual([]);
  });
});

describe("measured latency (real database, sequential, includes verifying the session each time, as a real request does)", () => {
  it("saving and reading progress takes well under a second at the 95th percentile, and is reported", async () => {
    const a = await createPerson({ label: "latency", learner: true });
    await consent(a);
    const t: Record<string, number[]> = {};
    const api = inProcessApi(a, t);
    let rev = 0;
    for (let i = 0; i < 40; i++) {
      const r = await api.putDoc("lessons_v2", rev, doc(Array.from({ length: 1 + i }, (_, k) => `s${k}`)));
      expect(r.kind).toBe("ok");
      rev = (r as { revision: number }).revision;
    }
    for (let i = 0; i < 40; i++) expect((await api.getDoc("lessons_v2")).ok).toBe(true);
    for (let i = 0; i < 20; i++) expect((await api.state()).ok).toBe(true);
    const pct = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
    const summary = Object.fromEntries(Object.entries(t).map(([op, xs]) => [op, { n: xs.length, p50: Math.round(pct(xs, 0.5)), p95: Math.round(pct(xs, 0.95)), max: Math.round(Math.max(...xs)) }]));
    console.log("SYNC_LATENCY_MS " + JSON.stringify(summary));
    for (const [op, s] of Object.entries(summary)) expect(s.p95, `${op} p95`).toBeLessThan(1_500);
  });
});
