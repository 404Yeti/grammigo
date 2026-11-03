import { getStorageScope } from "@/lib/scope/storage-scope";

interface Clip { key: string; blob: Blob; at: number }
const MAX_CLIPS = 24;
// IndexedDB also works where WebKit restricts Cache Storage. No transcripts are stored.
function transaction<T>(name: string, mode: IDBTransactionMode, fallback: T, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  return new Promise(resolve => {
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db?.close();
      resolve(value);
    };
    const timer = setTimeout(() => { finish(fallback); try { tx?.abort(); } catch { /* already finished */ } }, 2000);
    try {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("clips", { keyPath: "key" }).createIndex("at", "at");
      request.onerror = request.onblocked = () => finish(fallback);
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        try {
          tx = db.transaction("clips", mode);
          let value = fallback;
          tx.oncomplete = () => finish(value);
          tx.onerror = tx.onabort = () => finish(fallback);
          work(tx.objectStore("clips"), next => { value = next; });
        } catch { finish(fallback); }
      };
    } catch { finish(fallback); }
  });
}

/** Bounded, learner-scoped device audio storage; every operation fails open within two seconds. */
export async function debriefClipCache(body: string) {
  if (typeof indexedDB === "undefined") return null;
  const name = `grammigo-debrief-v1-${getStorageScope() || "guest"}`;
  return {
    read: async () => {
      const blob = await transaction<Blob | undefined>(name, "readonly", undefined, (store, result) => {
        const request = store.get(body);
        request.onsuccess = () => {
          const clip = request.result as Clip | undefined;
          if (clip?.blob instanceof Blob) result(clip.blob);
        };
      });
      return blob ? new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }) : undefined;
    },
    write: async (blob: Blob) => {
      await transaction(name, "readwrite", undefined, store => {
        store.put({ key: body, blob, at: Date.now() } satisfies Clip);
        const request = store.index("at").getAllKeys();
        request.onsuccess = () => {
          const keys = request.result;
          for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CLIPS))) store.delete(old);
        };
      });
    },
  };
}
