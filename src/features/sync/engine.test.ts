import { describe, expect, it, vi } from "vitest";
import { createRun } from "@/features/diagnostic/engine";
import { createSession } from "@/features/practice/session";
import { emptyState } from "@/lib/storage/schema";
import { lesson } from "@/tests/helpers";
import type { StoredState } from "@/types/session";
import { hashDocument } from "./canonical";
import { Clock, Device } from "./sim";
import type { ApiResult, Failure, PutResult, SyncApi } from "./engine";
import type { SyncMeta } from "./meta";
import type { DocKey, RemoteDoc, SyncState } from "./documents";
import { adoptLessons } from "./merge";
import { emptyGuidedState } from "@/features/guided/store/schema";

// the clock and the simulated device live in ./sim, shared with the integration tests
// ---- an account on the server, and a network that can misbehave --------------------------------------------------------------------------

class Account {
  consent = false;
  docs: Partial<Record<DocKey, { revision: number; body: Record<string, unknown> }>> = {};
}
type Fault = Failure | "lose-answer";
class FakeApi implements SyncApi {
  calls: { op: string; key?: DocKey; expected?: number; keepalive?: boolean }[] = [];
  faults: Fault[] = [];
  gate: Promise<void> | null = null;
  constructor(readonly account: Account) {}
  private fault(): Failure | "lose-answer" | null {
    return this.faults.shift() ?? null;
  }
  private fail<T>(f: Failure): ApiResult<T> {
    return { ok: false, ms: 5, ...f };
  }
  async state(): Promise<ApiResult<SyncState>> {
    this.calls.push({ op: "state" });
    const f = this.fault();
    if (f && f !== "lose-answer") return this.fail(f);
    const doc = (k: DocKey) => (this.account.docs[k] ? { revision: this.account.docs[k]!.revision, updatedAt: "now" } : null);
    return { ok: true, ms: 5, value: { consent: this.account.consent, documents: { lessons_v2: doc("lessons_v2"), guided_v1: doc("guided_v1") } } };
  }
  async getDoc(key: DocKey): Promise<ApiResult<RemoteDoc | null>> {
    this.calls.push({ op: "get", key });
    const f = this.fault();
    if (f && f !== "lose-answer") return this.fail(f);
    const d = this.account.docs[key];
    return { ok: true, ms: 5, value: d ? { revision: d.revision, body: JSON.parse(JSON.stringify(d.body)), updatedAt: "now" } : null };
  }
  async putDoc(key: DocKey, expected: number, body: unknown, opts?: { keepalive?: boolean }): Promise<PutResult> {
    this.calls.push({ op: "put", key, expected, keepalive: opts?.keepalive });
    if (this.gate) await this.gate;
    const f = this.fault();
    if (f && f !== "lose-answer") return { kind: "fail", ms: 5, ...f };
    if (!this.account.consent) return { kind: "fail", ms: 5, reason: "consent_required" };
    const cur = this.account.docs[key];
    if ((cur?.revision ?? 0) !== expected) return { kind: "conflict", ms: 5, revision: cur?.revision ?? 0, body: cur ? JSON.parse(JSON.stringify(cur.body)) : null };
    const revision = expected + 1;
    this.account.docs[key] = { revision, body: JSON.parse(JSON.stringify(body)) };
    if (f === "lose-answer") return { kind: "fail", ms: 5, reason: "offline" }; // it LANDED, but the answer was lost on the way back
    return { kind: "ok", ms: 5, revision };
  }
  async consent(): Promise<ApiResult<{ consent: true }>> {
    this.calls.push({ op: "consent" });
    const f = this.fault();
    if (f && f !== "lose-answer") return this.fail(f);
    this.account.consent = true;
    return { ok: true, ms: 5, value: { consent: true } };
  }
  count = (op: string) => this.calls.filter((c) => c.op === op).length;
  clear = () => void (this.calls = []);
}

// ---- one "device": its own saved progress, its own sync memory --------------------------------------------------------------------------

const consented = (): Partial<SyncMeta> => ({ consent: true });
function setup(account = new Account(), metaInit: Partial<SyncMeta> = {}) {
  const clock = new Clock();
  const api = new FakeApi(account);
  const dev = new Device(clock, api, metaInit);
  return { clock, api, dev, account };
}

describe("no round trip per answer", () => {
  it("answering never touches the network: 200 answers across a lesson make ZERO calls, and none is waiting on a network result", async () => {
    const { dev, api, clock } = setup(new Account(), consented());
    dev.boot();
    await clock.advance(2_000); // the start-up check runs once, off the critical path
    api.clear();
    for (let i = 0; i < 200; i++) dev.answer("s1", i % 8);
    expect(api.calls).toEqual([]);
    expect(dev.engine.getStatus().unsaved).toBe(true);
  });

  it("the unsaved work is saved in ONE batch after a quiet spell, not once per answer", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    for (let i = 0; i < 50; i++) dev.answer("s1", i % 8);
    await clock.advance(60_000);
    expect(api.calls).toEqual([]); // still quiet: nothing yet
    await clock.advance(61_000);
    expect(api.count("put")).toBe(1);
    expect(dev.engine.getStatus().unsaved).toBe(false);
  });

  it("finishing a lesson is a checkpoint: it saves a few seconds later, in one request, and not before", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    for (let i = 0; i < 7; i++) dev.answer("s1", i);
    dev.finish("s1");
    await clock.advance(2_000);
    expect(api.calls).toEqual([]); // the lesson is complete on the device; nothing waited for the network
    await clock.advance(1_500);
    expect(api.calls.map((c) => c.op)).toEqual(["put"]);
    expect(acct.docs.lessons_v2?.revision).toBe(1);
  });

  it("two lessons finished in quick succession become one save", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    dev.finish("a");
    await clock.advance(1_000);
    dev.finish("b");
    await clock.advance(10_000);
    expect(api.count("put")).toBe(1);
    expect((acct.docs.lessons_v2!.body.sessions as unknown[]).length).toBe(2);
  });

  it("nothing is saved when nothing has changed (and an empty progress is never uploaded)", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(300_000);
    expect(api.count("put")).toBe(0);
    expect(acct.docs.lessons_v2).toBeUndefined();
    dev.finish("x");
    await clock.advance(5_000);
    expect(api.count("put")).toBe(1);
    api.clear();
    dev.engine.syncNow();
    await clock.advance(1_000);
    expect(api.count("put")).toBe(0); // unchanged since it was saved
  });
});

describe("consent", () => {
  it("without recorded consent NOTHING is uploaded, however much progress exists, and the learner is told what is needed", async () => {
    const acct = new Account();
    const { dev, api, clock } = setup(acct);
    dev.finish("a");
    dev.boot();
    await clock.advance(600_000);
    expect(api.count("put")).toBe(0);
    expect(acct.docs.lessons_v2).toBeUndefined();
    expect(dev.engine.getStatus().phase).toBe("needs_consent");
    dev.finish("b");
    dev.engine.syncNow();
    await clock.advance(10_000);
    expect(api.count("put")).toBe(0);
  });

  it("NO trigger uploads learning data before consent: start-up, page-hide, reconnect, tab-visible, Save now, and the retries after a failed check", async () => {
    const acct = new Account(); // no consent recorded anywhere
    const { dev, api, clock } = setup(acct); // and none remembered on the device
    dev.finish("a");
    dev.boot(); // start-up
    await clock.advance(5_000);
    dev.answer("b", 2);
    dev.engine.flush(); // page-hide / close
    clock.isOnline = false;
    dev.engine.onOnline();
    clock.isOnline = true;
    dev.engine.onOnline(); // reconnect
    dev.engine.onVisible(); // tab visible again
    dev.engine.syncNow(); // "Save now"
    await clock.advance(60_000);
    api.faults = [{ reason: "unavailable" }, { reason: "unavailable" }, { reason: "offline" }]; // the status check itself fails, and is retried with back-off
    dev.engine.syncNow();
    await clock.advance(3_600_000);
    expect(api.count("put")).toBe(0);
    expect(api.calls.every((c) => c.op === "state")).toBe(true); // only read-only status checks: no document read or written, no consent written for them
    expect(acct.docs).toEqual({});
    expect(acct.consent).toBe(false);
    expect(dev.engine.getStatus().phase).toBe("needs_consent");
    // and a refused/aborted agreement (the consent call fails) uploads nothing either
    api.faults = [{ reason: "unavailable" }];
    dev.engine.enable();
    await clock.advance(5_000);
    expect(api.count("put")).toBe(0);
  });

  it("when the learner agrees, consent is recorded FIRST, then the progress is saved", async () => {
    const acct = new Account();
    const { dev, api, clock } = setup(acct);
    dev.finish("a");
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    dev.engine.enable();
    await clock.advance(1_000);
    expect(api.calls.map((c) => c.op)).toEqual(["consent", "state", "put"]);
    expect(acct.consent).toBe(true);
    expect(dev.engine.getStatus().phase).toBe("idle");
  });

  it("agreeing while offline is remembered, and nothing is uploaded until the server has been told", async () => {
    const acct = new Account();
    const { dev, api, clock } = setup(acct);
    dev.finish("a");
    dev.boot();
    clock.isOnline = false;
    dev.engine.enable();
    await clock.advance(10_000);
    expect(api.calls).toEqual([]);
    expect(dev.engine.getStatus().phase).toBe("offline");
    expect(dev.meta.consentPending).toBe(true);
    clock.isOnline = true;
    dev.engine.onOnline();
    await clock.advance(2_000);
    expect(api.calls.map((c) => c.op)).toEqual(["consent", "state", "put"]);
  });

  it("if the account's consent is withdrawn, saving stops and says so", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    acct.consent = false;
    dev.finish("a");
    await clock.advance(5_000);
    expect(dev.engine.getStatus().phase).toBe("needs_consent");
    expect(acct.docs.lessons_v2).toBeUndefined();
    api.clear();
    await clock.advance(600_000);
    expect(api.calls).toEqual([]); // and it does not keep retrying
  });
});

describe("offline, outages and retries: learning never waits", () => {
  it("offline: no requests, a plain 'offline' state, and everything is saved when the connection returns", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    clock.isOnline = false;
    dev.finish("a");
    await clock.advance(10_000);
    expect(api.calls).toEqual([]);
    expect(dev.engine.getStatus()).toMatchObject({ phase: "offline", unsaved: true });
    clock.isOnline = true;
    dev.engine.onOnline();
    await clock.advance(2_000);
    expect(api.count("put")).toBe(1);
    expect(dev.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
  });

  it("a failing server backs off 15s, 30s, 60s, 2m, 5m, then every 15m, and the app is unaffected throughout", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = Array.from({ length: 20 }, () => ({ reason: "unavailable" as const }));
    api.clear();
    dev.finish("a");
    const attemptTimes: number[] = [];
    let seen = 0;
    const t0 = clock.now();
    for (let i = 0; i < 6_000; i++) {
      await clock.advance(1_000);
      if (api.calls.length > seen) {
        // every attempt is one failed call (a retry starts with the status check, which fails first)
        seen = api.calls.length;
        attemptTimes.push((clock.now() - t0) / 1000);
      }
      if (seen >= 7) break;
    }
    const gaps = attemptTimes.slice(1).map((t, i) => Math.round(t - attemptTimes[i]));
    expect(gaps.slice(0, 5)).toEqual([15, 30, 60, 120, 300]);
    expect(gaps[5]).toBe(900);
    expect(dev.engine.getStatus().phase).toBe("retrying");
    expect(dev.lessons.sessions).toHaveLength(1); // the device's own progress is exactly as the learner left it
  });

  it("honours Retry-After when it is longer than the back-off", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = [{ reason: "rate_limited", retryAfter: 600 }];
    api.clear();
    dev.finish("a");
    await clock.advance(4_000);
    expect(api.count("put")).toBe(1);
    await clock.advance(500_000);
    expect(api.count("put")).toBe(1); // still waiting
    await clock.advance(120_000);
    expect(api.count("put")).toBe(2);
    expect(dev.engine.getStatus().phase).toBe("idle");
  });

  it("recovers by itself when the server comes back, and the failure count resets", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, clock, api } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = [{ reason: "unavailable" }, { reason: "unavailable" }];
    dev.finish("a");
    await clock.advance(200_000);
    expect(dev.engine.getStatus().phase).toBe("idle");
    expect(dev.meta.failures).toBe(0);
    expect(acct.docs.lessons_v2?.revision).toBe(1);
  });

  it("not signed in (401): it stops quietly and asks to sign in, instead of hammering the server", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = [{ reason: "unauthorized" }];
    dev.finish("a");
    await clock.advance(5_000);
    expect(dev.engine.getStatus().phase).toBe("needs_signin");
    api.clear();
    await clock.advance(3_600_000);
    expect(api.calls).toEqual([]);
  });

  it("a document that is too large stops with a plain state, and is not retried forever", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = [{ reason: "too_large" }];
    dev.finish("a");
    await clock.advance(5_000);
    expect(dev.engine.getStatus().phase).toBe("too_large");
    api.clear();
    await clock.advance(3_600_000);
    expect(api.calls).toEqual([]);
    expect(dev.lessons.sessions).toHaveLength(1);
  });

  it("a document over the size limit is NOT sent at all, says so, deletes nothing, and never reports 'saved'", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    const lastBefore = dev.engine.getStatus().lastSyncedAt;
    dev.finish("a");
    dev.setLessons({ ...dev.lessons, writingFeedback: { big: { text: "x".repeat(950_000) } } as never });
    await clock.advance(10_000);
    expect(api.count("put")).toBe(0); // the check is local: nothing was uploaded to find out
    const st = dev.engine.getStatus();
    expect(st.phase).toBe("too_large");
    expect(st.lastSyncedAt).toBe(lastBefore); // the 'last saved' time did not move: this progress was not saved
    expect(st.unsaved).toBe(true);
    expect(dev.lessons.sessions).toHaveLength(1); // nothing trimmed
    expect(JSON.stringify(dev.lessons).length).toBeGreaterThan(950_000);
    api.clear();
    await clock.advance(3_600_000);
    expect(api.calls).toEqual([]);
  });

  it("an unexpected error inside the engine is a failed attempt, never an exception in the app", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, clock, api } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    vi.spyOn(api, "putDoc").mockRejectedValueOnce(new Error("boom"));
    dev.finish("a");
    await expect(clock.advance(5_000)).resolves.toBeUndefined();
    expect(dev.engine.getStatus().phase).toBe("retrying");
  });
});

describe("two devices, conflicts and interrupted saves", () => {
  it("two devices that each finished a different lesson offline end up with BOTH on both devices", async () => {
    const acct = new Account();
    acct.consent = true;
    const clock = new Clock();
    const phone = new Device(clock, new FakeApi(acct), consented());
    const laptop = new Device(clock, new FakeApi(acct), consented());
    phone.boot();
    laptop.boot();
    await clock.advance(2_000);
    phone.finish("phone-lesson");
    laptop.finish("laptop-lesson");
    await clock.advance(6_000); // both save: the second gets a conflict, merges and saves again
    await clock.advance(6_000);
    expect(acct.docs.lessons_v2!.revision).toBe(2);
    expect((acct.docs.lessons_v2!.body.sessions as { id: string }[]).map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    phone.engine.syncNow();
    await clock.advance(2_000);
    expect(phone.lessons.sessions.map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    expect(laptop.lessons.sessions.map((s) => s.id).sort()).toEqual(["laptop-lesson", "phone-lesson"]);
    expect(hashDocument(phone.lessons)).toBe(hashDocument(laptop.lessons));
    expect(hashDocument(phone.lessons)).toBe(hashDocument(acct.docs.lessons_v2!.body));
  });

  it("a new device signs in to an account that already has progress: it receives it and uploads nothing extra", async () => {
    const acct = new Account();
    acct.consent = true;
    const clock = new Clock();
    const first = new Device(clock, new FakeApi(acct), consented());
    first.boot();
    await clock.advance(2_000);
    first.finish("one");
    first.setGuided({ ...emptyGuidedState() });
    await clock.advance(10_000);
    const fresh = new Device(clock, new FakeApi(acct), consented());
    fresh.boot();
    await clock.advance(3_000);
    expect(fresh.lessons.sessions.map((s) => s.id)).toEqual(["one"]);
    expect(fresh.api.count("put")).toBe(0);
    expect(fresh.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
  });

  it("an INTERRUPTED save (it landed, but the answer was lost) is harmless: the next run notices and does not duplicate or lose anything", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.faults = ["lose-answer"];
    dev.finish("a");
    await clock.advance(5_000);
    expect(acct.docs.lessons_v2?.revision).toBe(1); // it did land
    expect(dev.engine.getStatus().phase).toBe("retrying");
    await clock.advance(20_000);
    expect(dev.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
    expect(acct.docs.lessons_v2?.revision).toBe(1); // and it was not saved a second time
    expect((acct.docs.lessons_v2!.body.sessions as unknown[]).length).toBe(1);
  });

  it("progress made while a save is in flight is not lost, and is saved next", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    let open!: () => void;
    api.gate = new Promise<void>((r) => (open = r));
    dev.finish("first");
    await clock.advance(4_000); // the save is now waiting on the (slow) network
    dev.finish("second"); // meanwhile the learner finishes another lesson
    expect(dev.lessons.sessions.map((s) => s.id).sort()).toEqual(["first", "second"]);
    api.gate = null;
    open();
    await clock.advance(10_000);
    expect((acct.docs.lessons_v2!.body.sessions as { id: string }[]).map((s) => s.id).sort()).toEqual(["first", "second"]);
    expect(dev.engine.getStatus().unsaved).toBe(false);
  });

  it("only one sync runs at a time, however many triggers arrive", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    dev.finish("a");
    for (let i = 0; i < 10; i++) dev.engine.syncNow();
    dev.engine.onOnline();
    await clock.advance(5_000);
    expect(api.count("put")).toBe(1);
  });

  it("when the account's copy is from a NEWER app this one cannot read, nothing is overwritten on either side", async () => {
    const acct = new Account();
    acct.consent = true;
    acct.docs.lessons_v2 = { revision: 5, body: { version: 99, sessions: [], onboarding: {} } };
    const { dev, api, clock } = setup(acct, consented());
    dev.finish("local");
    dev.boot();
    await clock.advance(3_000);
    expect(dev.engine.getStatus().phase).toBe("blocked");
    expect(api.count("put")).toBe(0);
    expect(acct.docs.lessons_v2?.revision).toBe(5);
    expect(dev.lessons.sessions).toHaveLength(1);
  });

  it("each account has its own sync memory: one learner's revisions are never reused for another", async () => {
    const clock = new Clock();
    const a = new Account();
    a.consent = true;
    const b = new Account();
    b.consent = true;
    const da = new Device(clock, new FakeApi(a), consented());
    const db = new Device(clock, new FakeApi(b), consented());
    da.boot();
    db.boot();
    await clock.advance(2_000);
    da.finish("alpha");
    await clock.advance(6_000);
    expect(a.docs.lessons_v2?.revision).toBe(1);
    expect(b.docs.lessons_v2).toBeUndefined();
    expect(db.meta.docs.lessons_v2.baseRevision).toBe(0);
    expect(db.lessons.sessions).toEqual([]);
  });
});

describe("pause, flush, status and measurement", () => {
  it("turning sync off stops all requests, deletes nothing, and turning it on resumes", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    dev.engine.pause();
    api.clear();
    dev.finish("a");
    await clock.advance(600_000);
    expect(api.calls).toEqual([]);
    expect(dev.engine.getStatus().phase).toBe("off");
    dev.engine.enable();
    await clock.advance(2_000);
    expect(acct.docs.lessons_v2?.revision).toBe(1);
  });

  it("leaving the page sends one best-effort save of unsaved work, without conflict retries", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, api, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    api.clear();
    dev.answer("s", 3);
    dev.engine.flush();
    await clock.advance(100);
    expect(api.calls.filter((c) => c.op === "put")).toHaveLength(1);
    expect(api.calls.find((c) => c.op === "put")?.keepalive).toBe(true);
    api.clear();
    dev.engine.flush(); // nothing new: nothing sent
    await clock.advance(100);
    expect(api.calls).toEqual([]);
  });

  it("a request cut off because the page is closing is not a failure: no back-off, and the next visit checks the account straight away", async () => {
    const acct = new Account();
    acct.consent = true;
    const meta = { ...consented() };
    const first = setup(acct, meta);
    first.dev.boot();
    await first.clock.advance(2_000);
    first.api.faults = [{ reason: "offline" }];
    first.dev.engine.setLeaving(true); // pagehide fired; the browser aborts what is in flight
    first.dev.engine.syncNow();
    await first.clock.advance(1_000);
    expect(first.dev.meta.failures).toBe(0);
    expect(first.dev.meta.nextAttemptAt).toBeNull();
    // the same failure when the page is NOT leaving does count
    first.dev.engine.setLeaving(false);
    first.api.faults = [{ reason: "offline" }];
    first.dev.engine.syncNow();
    await first.clock.advance(1_000);
    expect(first.dev.meta.failures).toBe(1);
  });

  it("a new visit checks the account even if the previous visit ended inside a back-off, so a stale device catches up at once", async () => {
    const acct = new Account();
    acct.consent = true;
    acct.docs.lessons_v2 = { revision: 3, body: { ...JSON.parse(JSON.stringify(emptyState())), sessions: [] } };
    const { dev, api, clock } = setup(acct, { ...consented(), failures: 1, nextAttemptAt: 1_000_000 + 15_000 });
    dev.boot();
    await clock.advance(3_000); // far less than the 15 s left of the old back-off
    expect(api.count("state")).toBe(1);
  });

  it("records how long every call took, and summarises it", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, clock } = setup(acct, consented());
    dev.boot();
    await clock.advance(2_000);
    dev.finish("a");
    await clock.advance(5_000);
    const m = dev.engine.getMetrics();
    expect(m.calls).toBeGreaterThan(0);
    expect(m.byOp.put).toBe(1);
    expect(m.p50).toBe(5);
    expect(m.p95).toBe(5);
    expect(m.recent.every((c) => typeof c.ms === "number" && typeof c.at === "number")).toBe(true);
  });

  it("the status moves through saving to saved, with the time it last saved", async () => {
    const acct = new Account();
    acct.consent = true;
    const { dev, clock } = setup(acct, consented());
    const seen: string[] = [];
    dev.boot();
    dev.engine.subscribe(() => seen.push(dev.engine.getStatus().phase));
    await clock.advance(2_000);
    dev.finish("a");
    await clock.advance(5_000);
    expect(seen).toContain("syncing");
    expect(dev.engine.getStatus()).toMatchObject({ phase: "idle", unsaved: false });
    expect(dev.engine.getStatus().lastSyncedAt).not.toBeNull();
  });

  it("adopting what the account holds is exactly the documented merge (and so loses nothing)", async () => {
    const acct = new Account();
    acct.consent = true;
    const remote: StoredState = { ...emptyState(), sessions: [{ ...createSession(lesson, "remote", 5), status: "completed", completedAt: 9, updatedAt: 9 }], diagnosticRuns: [{ ...createRun("r", [], 1), finishedAt: 2 }] };
    acct.docs.lessons_v2 = { revision: 3, body: remote as unknown as Record<string, unknown> };
    const { dev, clock } = setup(acct, consented());
    dev.finish("local");
    const local = dev.lessons;
    dev.boot();
    await clock.advance(3_000);
    expect(hashDocument(dev.lessons)).toBe(hashDocument(adoptLessons(local, remote)));
    expect(dev.lessons.sessions.map((s) => s.id).sort()).toEqual(["local", "remote"]);
  });
});
