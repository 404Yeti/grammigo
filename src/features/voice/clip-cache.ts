import { getStorageScope } from "@/lib/scope/storage-scope";

interface Clip { key: string; blob: Blob; at: number }
const MAX_CLIPS = 24;
const MAX_BYTES = 768_000;
const TAB_KEY = "grammigo:debrief-audio:v1";
// One latest clip per tab, separate from localStorage progress quotas. No transcripts.
function tabClip(scope: string, key: string): Blob | undefined {
  try {
    const clip = JSON.parse(sessionStorage.getItem(TAB_KEY) ?? "null");
    if (clip?.version !== 1 || clip.scope !== scope || clip.key !== key || typeof clip.audio !== "string" || clip.audio.length > 1_024_000 || typeof clip.type !== "string" || !/^audio\/[\w.+-]+$/.test(clip.type)) return;
    const binary = atob(clip.audio);
    if (!binary.length || binary.length > MAX_BYTES) return;
    return new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: clip.type });
  } catch { /* disabled or corrupt tab storage */ }
}
async function saveTabClip(scope: string, key: string, blob: Blob) {
  if (!blob.size || blob.size > MAX_BYTES) return;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    sessionStorage.setItem(TAB_KEY, JSON.stringify({ version: 1, scope, key, type: blob.type, audio: btoa(binary) }));
  } catch { /* replay falls back to existing memory/server caches */ }
}
// Prefer binary storage; the bounded tab cache covers denied or unsupported persistence.
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

/** Learner-scoped audio storage; IndexedDB operations fail open within two seconds. */
export async function debriefClipCache(body: string) {
  const scope = getStorageScope();
  const name = `grammigo-debrief-v1-${scope || "guest"}`;
  return {
    read: async () => {
      const stored = await transaction<Blob | undefined>(name, "readonly", undefined, (store, result) => {
        const request = store.get(body);
        request.onsuccess = () => {
          const clip = request.result as Clip | undefined;
          if (clip?.blob instanceof Blob) result(clip.blob);
        };
      });
      const blob = stored ?? tabClip(scope, body);
      return blob ? new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }) : undefined;
    },
    write: async (blob: Blob) => {
      const stored = await transaction<boolean>(name, "readwrite", false, (store, result) => {
        result(true);
        store.put({ key: body, blob, at: Date.now() } satisfies Clip);
        const request = store.index("at").getAllKeys();
        request.onsuccess = () => {
          const keys = request.result;
          for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CLIPS))) store.delete(old);
        };
      });
      if (!stored) await saveTabClip(scope, body, blob);
    },
  };
}
