import { getStorageScope } from "@/lib/scope/storage-scope";

// Cache only debrief audio on this device, under the current learner's namespace.
// A content hash avoids putting outcomes in URLs. Eviction bounds device storage.
export async function debriefClipCache(body: string) {
  if (typeof caches === "undefined" || !globalThis.crypto?.subtle) return null;
  const scope = getStorageScope();
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
    const cache = await caches.open(`grammigo-debrief-v1-${scope || "guest"}`);
    const key = new URL(`/__migo-debrief/${hash}`, location.origin).href;
    return {
      read: async () => { try { return await cache.match(key); } catch { return undefined; } },
      write: async (blob: Blob) => {
        try {
          await cache.put(key, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - 24))) await cache.delete(old);
        } catch { /* unavailable storage never blocks completion or playback */ }
      },
    };
  } catch { return null; }
}
