import { GUIDED_STORAGE_KEY, parseGuidedState } from "@/features/guided/store/schema";
import { scopedKey } from "@/lib/scope/storage-scope";
import { getGuidedSnapshot, subscribeGuided, updateGuided } from "@/features/guided/store/store";
import type { GuidedState } from "@/types/guided";
import type { DocAdapter } from "./engine";
import { adoptGuided } from "./merge-guided";

/**
 * Guided Correction activity as its OWN syncable document, handled entirely separately from lesson progress. Nothing here reads, writes or
 * influences mastery, the learning profile or recommendations, and its provisional outcomes are saved as the counts of activity they are.
 */
export type GuidedIO = { read(): GuidedState; update(fn: (s: GuidedState) => GuidedState): void; subscribe(l: () => void): () => void };

export function guidedAdapter(io: GuidedIO): DocAdapter {
  return {
    key: "guided_v1",
    read: () => io.read(),
    parse: (body) => {
      const r = parseGuidedState(JSON.stringify(body));
      return r.kind === "ok" ? r.state : null;
    },
    adopt: (remote) => io.update((cur) => adoptGuided(cur, remote as GuidedState)),
    hasProgress: (doc) => (doc as GuidedState).sessions.length > 0,
    checkpointMarker: (doc) => (doc as GuidedState).sessions.filter((s) => s.status === "completed").length,
    subscribe: (l) => io.subscribe(l),
  };
}

export const storeGuidedAdapter = (): DocAdapter => guidedAdapter({ read: getGuidedSnapshot, update: (fn) => void updateGuided(fn), subscribe: subscribeGuided });

/** A READ-ONLY look at some learner's saved Guided Correction activity (see lib/storage/peek). Writes, caches and notifies nothing. */
export function peekGuidedState(forScope: string): GuidedState | null {
  try {
    const parsed = parseGuidedState(window.localStorage.getItem(scopedKey(GUIDED_STORAGE_KEY, forScope)));
    return parsed.kind === "ok" ? parsed.state : null;
  } catch {
    return null;
  }
}
