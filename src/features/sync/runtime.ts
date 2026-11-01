import { storeGuidedAdapter } from "./guided-doc";
import { storeLessonsAdapter } from "./doc-adapters";
import { browserScheduler, fetchSyncApi } from "./api-client";
import { SyncEngine, type SyncStatus } from "./engine";
import { parseMeta, type MetaStore } from "./meta";

/**
 * The browser's one sync engine, for whichever learner is signed in. It is created when a signed-in learner's folder is active and stopped
 * when that changes, so one learner's sync state, timers and requests never carry over to another.
 */
let current: { scope: string; engine: SyncEngine } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const syncMetaKey = (scope: string) => `grammigo:sync:v1:u:${scope}`;

export function localMetaStore(scope: string): MetaStore {
  const key = syncMetaKey(scope);
  return {
    read: () => {
      try {
        return parseMeta(window.localStorage.getItem(key));
      } catch {
        return parseMeta(null);
      }
    },
    write: (m) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(m));
      } catch {
        // storage full or blocked: syncing still works for this visit
      }
    },
  };
}

export function startSyncFor(scope: string): () => void {
  if (current?.scope === scope) return () => undefined;
  current?.engine.stop();
  const engine = new SyncEngine({ api: fetchSyncApi(), sched: browserScheduler(), meta: localMetaStore(scope), adapters: { lessons_v2: storeLessonsAdapter(), guided_v1: storeGuidedAdapter() } });
  current = { scope, engine };
  engine.subscribe(notify);
  engine.start();
  notify();

  const online = () => engine.onOnline();
  const visibility = () => (document.visibilityState === "hidden" ? engine.flush() : engine.onVisible());
  const hide = () => {
    engine.setLeaving(true); // requests the browser now cuts off are not failures
    engine.flush();
  };
  const show = () => engine.setLeaving(false); // restored from the back/forward cache
  window.addEventListener("online", online);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  document.addEventListener("visibilitychange", visibility);

  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    document.removeEventListener("visibilitychange", visibility);
    engine.stop();
    if (current?.engine === engine) current = null;
    notify();
  };
}

export const getSyncEngine = (): SyncEngine | null => current?.engine ?? null;
export const getSyncStatus = (): SyncStatus | null => current?.engine.getStatus() ?? null;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
