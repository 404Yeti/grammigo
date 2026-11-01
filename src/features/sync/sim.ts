import { createSession } from "@/features/practice/session";
import { emptyState } from "@/lib/storage/schema";
import { lesson } from "@/tests/helpers";
import type { Session, StoredState } from "@/types/session";
import { emptyGuidedState } from "@/features/guided/store/schema";
import type { GuidedState } from "@/types/guided";
import { lessonsAdapter } from "./doc-adapters";
import { SyncEngine, type Scheduler, type SyncApi } from "./engine";
import { emptyMeta, type SyncMeta } from "./meta";
import { guidedAdapter } from "./guided-doc";

/**
 * A simulated device for tests: its own saved progress, its own sync memory, a virtual clock. Several of them stand in for several phones
 * and laptops signed in to the same account. Used by the unit tests (against a fake server) and the integration tests (against the real one).
 */
export class Clock implements Scheduler {
  /** The devices running on this clock (each registers itself), so a test can wait for real I/O to finish. */
  devices: { engine: { getStatus(): { phase: string } } }[] = [];
  t = 1_000_000;
  isOnline = true;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private next = 1;
  now = () => this.t;
  set = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  clear = (id: unknown) => void (this.timers = this.timers.filter((x) => x.id !== id));
  random = () => 0.5; // jitter factor exactly 1.0
  online = () => this.isOnline;
  pending = () => this.timers.length;
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = end;
    await flush();
  }

  /**
   * Like `advance`, but for devices that talk to something REAL (a database): after each second of virtual time it also waits, in real time,
   * until every device's sync has finished what it started. Without this a test would move on before a save had actually completed.
   */
  async run(ms: number, timeoutMs = 20_000) {
    for (let left = ms; left > 0; left -= 1_000) {
      await this.advance(Math.min(1_000, left));
      const t0 = Date.now();
      for (;;) {
        await flush();
        if (this.devices.every((d) => d.engine.getStatus().phase !== "syncing")) {
          await new Promise((r) => setTimeout(r, 5));
          await flush();
          if (this.devices.every((d) => d.engine.getStatus().phase !== "syncing")) break;
        }
        if (Date.now() - t0 > timeoutMs) throw new Error("sync did not settle");
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }
}
export const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

export class Device<A extends SyncApi = SyncApi> {
  lessons: StoredState = emptyState();
  guided: GuidedState = emptyGuidedState();
  meta: SyncMeta;
  private ll = new Set<() => void>();
  private gl = new Set<() => void>();
  engine!: SyncEngine;
  constructor(readonly clock: Clock, readonly api: A, metaInit: Partial<SyncMeta> = {}) {
    this.meta = { ...emptyMeta(), ...metaInit };
    clock.devices.push(this as unknown as Clock["devices"][number]);
  }
  boot() {
    this.engine = new SyncEngine({
      api: this.api,
      sched: this.clock,
      meta: { read: () => this.meta, write: (m) => void (this.meta = m) },
      adapters: {
        lessons_v2: lessonsAdapter({ read: () => this.lessons, update: (fn) => this.setLessons(fn(this.lessons)), subscribe: (l) => (this.ll.add(l), () => this.ll.delete(l)) }),
        guided_v1: guidedAdapter({ read: () => this.guided, update: (fn) => this.setGuided(fn(this.guided)), subscribe: (l) => (this.gl.add(l), () => this.gl.delete(l)) }),
      },
    });
    this.engine.start();
    return this;
  }
  setLessons(s: StoredState) {
    this.lessons = s;
    this.ll.forEach((l) => l());
  }
  setGuided(s: GuidedState) {
    this.guided = s;
    this.gl.forEach((l) => l());
  }
  /** One answer: the session changes in place, exactly like the real store (a change event, no finishing). */
  answer(id = "s1", index = 1) {
    const cur = this.lessons.sessions.find((s) => s.id === id) ?? createSession(lesson, id, this.clock.now());
    const next: Session = { ...cur, currentIndex: index, updatedAt: this.clock.now() };
    this.setLessons({ ...this.lessons, sessions: [...this.lessons.sessions.filter((s) => s.id !== id), next], activeSessionId: id });
  }
  finish(id = "s1") {
    const cur = this.lessons.sessions.find((s) => s.id === id) ?? createSession(lesson, id, this.clock.now());
    const done: Session = { ...cur, status: "completed", completedAt: this.clock.now(), updatedAt: this.clock.now(), currentIndex: 7, phase: "feedback" };
    this.setLessons({ ...this.lessons, sessions: [...this.lessons.sessions.filter((s) => s.id !== id), done], activeSessionId: null });
  }
}

