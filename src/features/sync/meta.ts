import type { DocKey } from "./documents";

/**
 * What this browser remembers about syncing ONE account (kept per account, so one learner's sync state is never another's):
 * which revision of each document it last saw, and a fingerprint of what it last saved, so it can tell later whether anything changed.
 * It holds no progress and no personal data.
 */
export type DocMeta = { baseRevision: number; savedHash: string | null };
export type SyncMeta = {
  v: 1;
  /** The last thing the server told us about this learner's consent. null = not asked yet. */
  consent: boolean | null;
  /** The learner chose to turn sync on here, but the server has not yet been told (offline). Nothing is uploaded until it has. */
  consentPending: boolean;
  docs: Record<DocKey, DocMeta>;
  lastSyncedAt: number | null;
  failures: number;
  nextAttemptAt: number | null;
  /** The learner turned sync off on this device. */
  paused: boolean;
};

export const emptyMeta = (): SyncMeta => ({
  v: 1,
  consent: null,
  consentPending: false,
  docs: { lessons_v2: { baseRevision: 0, savedHash: null }, guided_v1: { baseRevision: 0, savedHash: null } },
  lastSyncedAt: null,
  failures: 0,
  nextAttemptAt: null,
  paused: false,
});

export interface MetaStore {
  read(): SyncMeta;
  write(meta: SyncMeta): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

function parseDoc(v: unknown): DocMeta {
  return isObj(v) ? { baseRevision: Math.floor(num(v.baseRevision, 0)), savedHash: typeof v.savedHash === "string" ? v.savedHash : null } : { baseRevision: 0, savedHash: null };
}

/** Anything unexpected falls back to a clean slate: the worst case is one extra, harmless sync. */
export function parseMeta(raw: string | null): SyncMeta {
  if (!raw) return emptyMeta();
  try {
    const d: unknown = JSON.parse(raw);
    if (!isObj(d) || d.v !== 1) return emptyMeta();
    const docs = isObj(d.docs) ? d.docs : {};
    return {
      v: 1,
      consent: typeof d.consent === "boolean" ? d.consent : null,
      consentPending: d.consentPending === true,
      docs: { lessons_v2: parseDoc(docs.lessons_v2), guided_v1: parseDoc(docs.guided_v1) },
      lastSyncedAt: typeof d.lastSyncedAt === "number" ? d.lastSyncedAt : null,
      failures: Math.floor(num(d.failures, 0)),
      nextAttemptAt: typeof d.nextAttemptAt === "number" ? d.nextAttemptAt : null,
      paused: d.paused === true,
    };
  } catch {
    return emptyMeta();
  }
}
