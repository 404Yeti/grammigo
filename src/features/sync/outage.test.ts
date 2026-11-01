import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchGuided, startGuidedSession } from "@/features/guided/store/actions";
import { guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { practiceActions, startSession } from "@/features/practice/actions";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { getSnapshot } from "@/lib/storage/store";
import { CORRECT_ANSWERS, lesson, resetApp } from "@/tests/helpers";
import { storeLessonsAdapter } from "./doc-adapters";
import { SyncEngine, type ApiResult, type PutResult, type Scheduler, type SyncApi } from "./engine";
import { storeGuidedAdapter } from "./guided-doc";
import { emptyMeta } from "./meta";

/**
 * "A database outage never blocks a lesson." These run the REAL lesson actions on the REAL saved-progress stores, with a sync engine alive
 * and pointed at a network that hangs, fails, errors or crawls, and prove the lesson completes as fast as it does with no account at all.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class Clock implements Scheduler {
  t = 5_000_000;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private n = 1;
  now = () => this.t;
  set = (fn: () => void, ms: number) => (this.timers.push({ id: this.n, at: this.t + ms, fn }), this.n++);
  clear = (id: unknown) => void (this.timers = this.timers.filter((x) => x.id !== id));
  random = () => 0.5;
  online = () => true;
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      for (let i = 0; i < 40; i++) await Promise.resolve();
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
    for (let i = 0; i < 40; i++) await Promise.resolve();
  }
}

type Mode = "hang" | "refuse" | "error500" | "slow";
function hostileApi(mode: Mode, log: string[]): SyncApi {
  const never = <T>() => new Promise<T>(() => undefined);
  const fail = (): ApiResult<never> => ({ ok: false, reason: mode === "refuse" ? "offline" : "unavailable", ms: 1 }) as ApiResult<never>;
  const respond = async <T>(op: string, ok: T): Promise<ApiResult<T>> => {
    log.push(op);
    if (mode === "hang") return never();
    if (mode === "slow") return new Promise(() => setTimeout(() => undefined, 1e9)); // effectively never within the test
    void ok;
    return fail();
  };
  return {
    state: () => respond("state", { consent: true, documents: { lessons_v2: null, guided_v1: null } }),
    getDoc: () => respond("get", null),
    consent: () => respond("consent", { consent: true as const }),
    putDoc: async (): Promise<PutResult> => {
      log.push("put");
      if (mode === "hang" || mode === "slow") return never();
      return { kind: "fail", reason: mode === "refuse" ? "offline" : "unavailable", ms: 1 };
    },
  };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);

beforeEach(() => {
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => process.off("unhandledRejection", onUnhandled));

function playWholeLesson(): string {
  const id = startSession(lesson);
  for (let i = 0; i < 8; i++) {
    practiceActions.setDraft(id, CORRECT_ANSWERS[i]);
    practiceActions.submit(id, lesson);
    practiceActions.advance(id);
  }
  return id;
}

function timeIt(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("a database outage never blocks a lesson", () => {
  it("baseline: how long a whole 8-question lesson takes with no account at all", () => {
    const ms = timeIt(playWholeLesson);
    expect(ms).toBeLessThan(2_000);
    expect(getSnapshot().sessions[0].status).toBe("completed");
  });

  for (const mode of ["hang", "refuse", "error500", "slow"] as const) {
    it(`network ${mode}: the lesson completes, in about the same time, with zero requests while answering and no unhandled error`, async () => {
      const baseline = timeIt(playWholeLesson);
      resetApp();

      setStorageScope(A);
      const log: string[] = [];
      const clock = new Clock();
      const engine = new SyncEngine({ api: hostileApi(mode, log), sched: clock, meta: { read: () => ({ ...emptyMeta(), consent: true }), write: () => undefined }, adapters: { lessons_v2: storeLessonsAdapter(), guided_v1: storeGuidedAdapter() } });
      engine.start();
      await clock.advance(2_000); // the start-up check happens (and fails or hangs) off to the side
      log.length = 0;

      let id = "";
      const ms = timeIt(() => {
        id = playWholeLesson();
      });
      expect(getSnapshot().sessions.find((s) => s.id === id)?.status).toBe("completed"); // the lesson is complete, on this device, instantly
      expect(log).toEqual([]); // not one request was made WHILE answering
      expect(ms).toBeLessThan(baseline * 3 + 50); // and answering was not slowed by the engine being alive

      // later, at the checkpoint, the save is attempted (and fails or hangs); the learner is not in the way of it
      await clock.advance(10_000);
      expect(log.filter((o) => o === "put").length).toBeLessThanOrEqual(1);
      expect(engine.getStatus().unsaved).toBe(true); // truthfully: not saved online yet
      expect(getSnapshot().sessions.find((s) => s.id === id)?.status).toBe("completed"); // and nothing was lost or changed
      expect(unhandled).toEqual([]);
      engine.stop();
    });
  }

  it("Guided Correction steps are just as local: every step is instant and none touches the network", async () => {
    setStorageScope(A);
    const log: string[] = [];
    const clock = new Clock();
    const engine = new SyncEngine({ api: hostileApi("hang", log), sched: clock, meta: { read: () => ({ ...emptyMeta(), consent: true }), write: () => undefined }, adapters: { lessons_v2: storeLessonsAdapter(), guided_v1: storeGuidedAdapter() } });
    engine.start();
    await clock.advance(2_000);
    log.length = 0;
    const NOW = 1_800_000_000_000;
    const ms = timeIt(() => {
      startGuidedSession({ now: NOW, id: "g" });
      dispatchGuided("g", { type: "EDIT", draft: "I have watched a film yesterday evening." }, { now: NOW + 1, aiAvailable: true });
      dispatchGuided("g", { type: "SUBMIT" }, { now: NOW + 2, aiAvailable: true });
      dispatchGuided("g", { type: "REQUEST_HINT" }, { now: NOW + 3, aiAvailable: true });
      dispatchGuided("g", { type: "EDIT", draft: "I watched a film with my sister." }, { now: NOW + 4, aiAvailable: true });
      dispatchGuided("g", { type: "SUBMIT" }, { now: NOW + 5, aiAvailable: true });
    });
    expect(ms).toBeLessThan(500);
    expect(log).toEqual([]);
    engine.stop();
  });

  it("a hung network does not pile up work: repeated triggers while one attempt is stuck make no further requests", async () => {
    setStorageScope(A);
    const log: string[] = [];
    const clock = new Clock();
    const engine = new SyncEngine({ api: hostileApi("hang", log), sched: clock, meta: { read: () => ({ ...emptyMeta(), consent: true }), write: () => undefined }, adapters: { lessons_v2: storeLessonsAdapter(), guided_v1: storeGuidedAdapter() } });
    engine.start();
    await clock.advance(2_000);
    const stuck = log.length;
    for (let i = 0; i < 25; i++) engine.syncNow();
    playWholeLesson();
    await clock.advance(3_600_000);
    expect(log.length).toBe(stuck); // one attempt is stuck; nothing queues behind it, and the app is unaffected
    expect(getSnapshot().sessions).toHaveLength(1);
    engine.stop();
  });
});
