import { hashDocument } from "./canonical";
import { DOC_KEYS, type DocKey, type RemoteDoc, type SyncState } from "./documents";
import { emptyMeta, type MetaStore, type SyncMeta } from "./meta";

/**
 * Local-first progress sync, as a self-contained state machine. Everything it touches is injected (the network, the clock, timers, the two
 * saved-progress stores), so it is exercised deterministically in tests and never reaches for a global.
 *
 * THE RULES IT KEEPS
 *  - Learning never waits for it. It is only ever started by a timer, a page event or a button; nothing in the lesson path calls it, and its
 *    errors are caught here, never thrown into the app.
 *  - No round trip per answer or per Guided Correction step. Changes only mark "unsaved" (a flag). The network is touched at CHECKPOINTS:
 *    when the page loads, when a lesson or guided session is finished, when the page is hidden or closed, when the connection returns, after a
 *    quiet spell, and when the learner presses "Save now". Work in between is batched into one save.
 *  - Nothing is uploaded without the learner's recorded consent.
 *  - Saves are compare-and-swap from the revision this device last saw. If another device saved first, the answer carries the account's copy;
 *    it is merged (a union that loses nothing, see merge.ts) and the save is retried. Repeating any step is harmless.
 *  - Failures back off (with jitter) and never block anything. An interrupted sync leaves the device exactly as before, and the next run picks up.
 */

export type DocAdapter = {
  key: DocKey;
  /** The document as currently saved on this device. */
  read(): unknown;
  /** Validates a document that came from the server. Null = not something this version understands (nothing is overwritten). */
  parse(body: unknown): unknown | null;
  /** Folds the account's copy into this device's, as ONE atomic update of the saved state (so edits made meanwhile are never lost). Throws if it cannot. */
  adopt(remote: unknown): void;
  /** True when there is something worth saving (an empty document is never uploaded). */
  hasProgress(doc: unknown): boolean;
  /** A number that goes up when a lesson or guided session is FINISHED: the checkpoint signal. */
  checkpointMarker(doc: unknown): number;
  subscribe(listener: () => void): () => void;
};

export type Failure = { reason: "offline" | "unavailable" | "unauthorized" | "consent_required" | "rate_limited" | "too_large" | "invalid" | "other"; retryAfter?: number };
export type CallInfo = { ms: number };
export type ApiResult<T> = ({ ok: true; value: T } | ({ ok: false } & Failure)) & CallInfo;
export type PutResult = ({ kind: "ok"; revision: number } | { kind: "conflict"; revision: number; body: unknown | null } | ({ kind: "fail" } & Failure)) & CallInfo;

export interface SyncApi {
  state(): Promise<ApiResult<SyncState>>;
  getDoc(key: DocKey): Promise<ApiResult<RemoteDoc | null>>;
  putDoc(key: DocKey, expectedRevision: number, body: unknown, opts?: { keepalive?: boolean }): Promise<PutResult>;
  consent(): Promise<ApiResult<{ consent: true }>>;
}

export type Timer = unknown;
export interface Scheduler {
  now(): number;
  set(fn: () => void, ms: number): Timer;
  clear(t: Timer): void;
  random(): number;
  online(): boolean;
}

export type SyncPhase = "off" | "needs_consent" | "idle" | "syncing" | "offline" | "retrying" | "needs_signin" | "too_large" | "blocked";
export type SyncStatus = {
  phase: SyncPhase;
  /** Changes made on this device that are not saved to the account yet. */
  unsaved: boolean;
  lastSyncedAt: number | null;
  nextAttemptAt: number | null;
  paused: boolean;
};

export type CallMetric = { op: "state" | "get" | "put" | "consent"; ms: number; ok: boolean; at: number };
export type SyncMetrics = { calls: number; byOp: Record<string, number>; p50: number | null; p95: number | null; max: number | null; recent: CallMetric[] };

export type EngineOptions = {
  api: SyncApi;
  adapters: Record<DocKey, DocAdapter>;
  meta: MetaStore;
  sched: Scheduler;
  /** How long after a finished lesson before saving (lets a quick succession of checkpoints become one save). */
  checkpointDelayMs?: number;
  /** How long a quiet spell with unsaved work must last before saving anyway. */
  idleFlushMs?: number;
  startDelayMs?: number;
  backoffMs?: number[];
  maxConflictRetries?: number;
};

const DEFAULTS = { checkpointDelayMs: 3_000, idleFlushMs: 120_000, startDelayMs: 1_500, backoffMs: [15_000, 30_000, 60_000, 120_000, 300_000, 900_000], maxConflictRetries: 3 };

export class SyncEngine {
  private readonly o: Required<Omit<EngineOptions, "api" | "adapters" | "meta" | "sched">> & Pick<EngineOptions, "api" | "adapters" | "meta" | "sched">;
  private metaCache: SyncMeta;
  private phase: SyncPhase;
  private unsaved = false;
  private running = false;
  private again: { force: boolean } | null = null;
  private timer: Timer | null = null;
  private timerAt = 0;
  private idleTimer: Timer | null = null;
  private markers: Record<DocKey, number>;
  private unsubscribers: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private stopped = false;
  private ring: CallMetric[] = [];
  private calls = 0;
  private byOp: Record<string, number> = {};
  private snapshot: SyncStatus;

  constructor(options: EngineOptions) {
    this.o = { ...DEFAULTS, ...options };
    this.metaCache = this.o.meta.read();
    this.markers = { lessons_v2: this.marker("lessons_v2"), guided_v1: this.marker("guided_v1") };
    this.phase = this.initialPhase();
    this.snapshot = this.buildSnapshot();
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------------------------------

  /** Begins listening. It does NOT touch the network now: the first run is scheduled a moment later, off the critical path. */
  start(): void {
    if (this.stopped) return;
    for (const key of DOC_KEYS) this.unsubscribers.push(this.o.adapters[key].subscribe(() => this.onLocalChange(key)));
    this.unsaved = this.detectUnsaved();
    this.publish();
    if (!this.metaCache.paused) this.schedule("start", this.o.startDelayMs);
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    if (this.timer !== null) this.o.sched.clear(this.timer);
    if (this.idleTimer !== null) this.o.sched.clear(this.idleTimer);
    this.timer = this.idleTimer = null;
    this.listeners.clear();
  }

  // ---- what the UI sees ------------------------------------------------------------------------------------------------------------------

  getStatus = (): SyncStatus => this.snapshot;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getMetrics(): SyncMetrics {
    const ms = this.ring.map((c) => c.ms).sort((a, b) => a - b);
    const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)] : null);
    return { calls: this.calls, byOp: { ...this.byOp }, p50: q(0.5), p95: q(0.95), max: ms.length ? ms[ms.length - 1] : null, recent: [...this.ring] };
  }

  // ---- triggers (every one of these is optional, asynchronous and non-blocking) -----------------------------------------------------------

  /** The learner agrees to keep their progress in their account. Local only until the server has been told. */
  enable(): void {
    this.setMeta({ paused: false, consentPending: this.metaCache.consent !== true });
    this.schedule("manual", 0, true);
  }

  /** The learner turns sync off on this device. Nothing is deleted anywhere. */
  pause(): void {
    this.setMeta({ paused: true });
    if (this.timer !== null) this.o.sched.clear(this.timer);
    this.timer = null;
    this.phase = "off";
    this.publish();
  }

  /** "Save now". */
  syncNow(): void {
    this.setMeta({ paused: false, nextAttemptAt: null });
    this.schedule("manual", 0, true);
  }

  /** The connection came back. */
  onOnline(): void {
    this.schedule("online", 500, true);
  }

  /** The tab became visible again. Checks the account for changes from other devices, but only if it has been a while. */
  onVisible(): void {
    const last = this.metaCache.lastSyncedAt;
    if (last === null || this.o.sched.now() - last > 5 * 60_000) this.schedule("online", 1_000, false);
  }

  /** The page is being hidden or closed: one best-effort save of anything unsaved. */
  flush(): void {
    if (this.metaCache.paused || !this.unsaved || this.metaCache.consent !== true) return;
    void this.run("flush", true, { keepalive: true });
  }

  // ---- internals -------------------------------------------------------------------------------------------------------------------------

  private marker(key: DocKey): number {
    try {
      return this.o.adapters[key].checkpointMarker(this.o.adapters[key].read());
    } catch {
      return 0;
    }
  }

  /** Called for EVERY change to saved progress, including each answer. It does a few comparisons and sets timers. It never touches the network. */
  private onLocalChange(key: DocKey): void {
    if (this.stopped) return;
    this.unsaved = true;
    const m = this.marker(key);
    const finished = m > this.markers[key];
    this.markers[key] = m;
    if (!this.metaCache.paused && this.metaCache.consent === true) {
      if (finished) this.schedule("checkpoint", this.o.checkpointDelayMs);
      else if (this.idleTimer === null) {
        this.idleTimer = this.o.sched.set(() => {
          this.idleTimer = null;
          this.schedule("idle", 0);
        }, this.o.idleFlushMs);
      }
    }
    this.publish();
  }

  private detectUnsaved(): boolean {
    return DOC_KEYS.some((k) => {
      const a = this.o.adapters[k];
      const doc = a.read();
      return a.hasProgress(doc) && hashDocument(doc) !== this.metaCache.docs[k].savedHash;
    });
  }

  private initialPhase(): SyncPhase {
    if (this.metaCache.paused) return "off";
    if (this.metaCache.consent === true) return "idle";
    return "needs_consent";
  }

  private buildSnapshot(): SyncStatus {
    return { phase: this.phase, unsaved: this.unsaved, lastSyncedAt: this.metaCache.lastSyncedAt, nextAttemptAt: this.metaCache.nextAttemptAt, paused: this.metaCache.paused };
  }

  private publish(): void {
    const next = this.buildSnapshot();
    const cur = this.snapshot;
    if (next.phase === cur.phase && next.unsaved === cur.unsaved && next.lastSyncedAt === cur.lastSyncedAt && next.nextAttemptAt === cur.nextAttemptAt && next.paused === cur.paused) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  private setMeta(patch: Partial<SyncMeta>): void {
    this.metaCache = { ...this.metaCache, ...patch };
    try {
      this.o.meta.write(this.metaCache);
    } catch {
      // storage unavailable: the in-memory copy still works for this visit
    }
    this.publish();
  }

  /** At most one timer is pending, and it is always the EARLIEST requested. */
  private schedule(reason: "start" | "checkpoint" | "idle" | "online" | "manual", delayMs: number, force = false): void {
    if (this.stopped) return;
    const now = this.o.sched.now();
    const gate = !force && this.metaCache.nextAttemptAt ? Math.max(0, this.metaCache.nextAttemptAt - now) : 0;
    const at = now + Math.max(delayMs, gate);
    if (this.timer !== null) {
      if (this.timerAt <= at) return;
      this.o.sched.clear(this.timer);
    }
    this.timerAt = at;
    this.timer = this.o.sched.set(() => {
      this.timer = null;
      void this.run(reason, force);
    }, at - now);
  }

  private record(op: CallMetric["op"], ms: number, ok: boolean): void {
    this.calls += 1;
    this.byOp[op] = (this.byOp[op] ?? 0) + 1;
    this.ring.push({ op, ms, ok, at: this.o.sched.now() });
    if (this.ring.length > 50) this.ring.shift();
  }

  private fail(f: Failure): void {
    const failures = this.metaCache.failures + 1;
    const table = this.o.backoffMs;
    const base = table[Math.min(failures - 1, table.length - 1)];
    const wait = Math.max(f.retryAfter ? f.retryAfter * 1000 : 0, Math.round(base * (0.75 + this.o.sched.random() * 0.5)));
    switch (f.reason) {
      case "unauthorized":
        this.phase = "needs_signin";
        this.setMeta({ failures: 0, nextAttemptAt: null });
        return;
      case "consent_required":
        this.phase = "needs_consent";
        this.setMeta({ consent: false, failures: 0, nextAttemptAt: null });
        return;
      case "too_large":
        this.phase = "too_large";
        this.setMeta({ failures: 0, nextAttemptAt: null });
        return;
      case "invalid":
        this.phase = "blocked";
        this.setMeta({ failures: 0, nextAttemptAt: null });
        return;
      default:
        this.phase = f.reason === "offline" && !this.o.sched.online() ? "offline" : "retrying";
        this.setMeta({ failures, nextAttemptAt: this.o.sched.now() + wait });
        if (!this.stopped) this.schedule("online", wait, true); // retry on its own, off the critical path
    }
  }

  /** One sync cycle. Single-flight: a request that arrives mid-cycle is remembered and runs afterwards. Never throws. */
  private async run(reason: string, force: boolean, opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.stopped || this.metaCache.paused) return;
    if (this.running) {
      this.again = { force: force || (this.again?.force ?? false) };
      return;
    }
    if (!this.o.sched.online()) {
      this.phase = "offline";
      this.publish();
      return;
    }
    this.running = true;
    this.phase = "syncing";
    this.publish();
    try {
      await this.cycle(reason, opts);
    } catch {
      this.fail({ reason: "other" }); // an unexpected error is a failed attempt, never a crash
    } finally {
      this.running = false;
      this.unsaved = this.detectUnsaved();
      this.publish();
      const again = this.again;
      this.again = null;
      if (again && !this.stopped) this.schedule("manual", 0, again.force);
      else if (this.unsaved && (this.phase as SyncPhase) === "idle" && this.metaCache.consent === true && this.idleTimer === null) this.schedule("idle", this.o.checkpointDelayMs);
    }
  }

  private async cycle(reason: string, opts: { keepalive?: boolean }): Promise<void> {
    const { api, adapters } = this.o;

    // 1. consent: nothing is uploaded until the server has it recorded
    if (this.metaCache.consentPending) {
      const r = await api.consent();
      this.record("consent", r.ms, r.ok);
      if (!r.ok) return this.fail(r);
      this.setMeta({ consent: true, consentPending: false });
    }

    // 2. what does the account hold? (skipped for a save at checkpoint when we already know consent: the save itself reports conflicts)
    let remote: SyncState | null = null;
    if (this.metaCache.consent !== true || reason === "start" || reason === "online" || reason === "manual") {
      const r = await api.state();
      this.record("state", r.ms, r.ok);
      if (!r.ok) return this.fail(r);
      remote = r.value;
      this.setMeta({ consent: r.value.consent });
    }
    if (this.metaCache.consent !== true) {
      this.phase = "needs_consent";
      this.setMeta({ failures: 0, nextAttemptAt: null });
      return;
    }

    for (const key of DOC_KEYS) {
      const a = adapters[key];
      // 3. pull: the account has a newer revision than the one this device last saw
      const head = remote?.documents[key]?.revision ?? null;
      if (head !== null && head > this.metaCache.docs[key].baseRevision) {
        const r = await api.getDoc(key);
        this.record("get", r.ms, r.ok);
        if (!r.ok) return this.fail(r);
        if (r.value) {
          const parsed = a.parse(r.value.body);
          if (parsed === null) return this.fail({ reason: "invalid" }); // a newer app wrote it: change nothing, say so
          a.adopt(parsed);
          // If that left this device holding exactly what the account holds, there is nothing to save.
          this.setDoc(key, { baseRevision: r.value.revision, ...(hashDocument(a.read()) === hashDocument(parsed) ? { savedHash: hashDocument(parsed) } : {}) });
        }
      }
      // 4. push: anything this device has that the account does not
      let attempts = 0;
      for (;;) {
        const doc = a.read();
        const hash = hashDocument(doc);
        if (!a.hasProgress(doc) || hash === this.metaCache.docs[key].savedHash) break;
        const sent = await api.putDoc(key, this.metaCache.docs[key].baseRevision, doc, opts);
        this.record("put", sent.ms, sent.kind === "ok");
        if (sent.kind === "ok") {
          this.setDoc(key, { baseRevision: sent.revision, savedHash: hash }); // fingerprint of what was SENT: edits made meanwhile stay "unsaved"
          break;
        }
        if (sent.kind === "fail") return this.fail(sent);
        // conflict: another device saved first. Fold its copy in (nothing is lost) and try again from its revision.
        if (opts.keepalive || ++attempts > this.o.maxConflictRetries) return this.fail({ reason: "other" });
        let body = sent.body;
        if (body === null) {
          const r = await api.getDoc(key);
          this.record("get", r.ms, r.ok);
          if (!r.ok) return this.fail(r);
          body = r.value?.body ?? null;
        }
        let theirs: unknown = null;
        if (body !== null) {
          theirs = a.parse(body);
          if (theirs === null) return this.fail({ reason: "invalid" });
          a.adopt(theirs);
        }
        // If folding the account's copy in left this device holding exactly what the account holds, it is already saved there. (That is also
        // what makes an interrupted save harmless: the save may have landed even though its answer was lost.)
        const same = theirs !== null && hashDocument(a.read()) === hashDocument(theirs);
        this.setDoc(key, { baseRevision: sent.revision, ...(same ? { savedHash: hashDocument(theirs) } : {}) });
      }
    }

    // 5. done
    this.phase = "idle";
    this.setMeta({ lastSyncedAt: this.o.sched.now(), failures: 0, nextAttemptAt: null });
  }

  private setDoc(key: DocKey, patch: Partial<SyncMeta["docs"][DocKey]>): void {
    this.setMeta({ docs: { ...this.metaCache.docs, [key]: { ...this.metaCache.docs[key], ...patch } } });
  }
}

export { emptyMeta };
