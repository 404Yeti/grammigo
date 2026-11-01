import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DOC_SCHEMA, isDocKey, MAX_DOC_BYTES, type DocKey, type RemoteDoc, type SyncState } from "@/features/sync/documents";
import { clientAddress } from "./client-ip";
import type { AuthConfig } from "./config";
import { PRIVACY_NOTICE_VERSION } from "./constants";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS, type LimitRule, type RateLimitStore } from "./rate-limit";
import type { Viewer } from "./viewer";

/**
 * Cloud-saved progress: the server half of local-first sync.
 *
 * WHO. The learner's id comes from the VERIFIED session and nowhere else. No route takes an id, so there is no way to name another learner.
 * READS. Through `client`, the learner's OWN session (row-level security): a read can only ever return the learner's own rows.
 * WRITES. A document can only be written by a database function that the browser cannot call, so the write goes through `service`, with the
 *   id above. The function refuses to store anything without the learner's recorded consent, validates the document, and is compare-and-swap:
 *   if the stored revision is not the one the caller started from, nothing is written and the current document is handed back to be merged.
 * Nothing here is on the lesson path: it is only ever called by a background sync, never by answering a question.
 */
export type SyncDeps = {
  config: AuthConfig;
  viewer: Viewer;
  client: SupabaseClient;
  service: SupabaseClient;
  limiter: RateLimitStore;
  headers: Headers;
  /** Milliseconds, for measuring how long the database took. */
  clock?: () => number;
};

export type SyncResult = { status: number; body: unknown; retryAfter?: number; dbMs?: number };

const envelope = z.strictObject({ expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), body: z.record(z.string(), z.unknown()) });
const consentBody = z.strictObject({ accept: z.literal(true) });

function refuse(viewer: Viewer): SyncResult | null {
  if (viewer.kind === "learner") return null;
  if (viewer.kind === "unavailable") return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  return viewer.kind === "anonymous" ? { status: 401, body: { error: "unauthenticated" } } : { status: 403, body: { error: "forbidden" } };
}

async function limited(d: SyncDeps, rules: LimitRule[], id: string): Promise<SyncResult | null> {
  try {
    const decision = await checkLimits(d.limiter, d.config.flowSecret, rules, `${id}:${clientAddress(d.headers)}`);
    return decision.allowed ? null : { status: 429, body: { error: "rate_limited" }, retryAfter: decision.retryAfter };
  } catch {
    return { status: 503, body: { error: "unavailable" }, retryAfter: 30 }; // fail closed
  }
}

/**
 * Whether THIS learner has consented, asked through the learner's own session and naming the learner explicitly. Row-level security only
 * ever returns the signed-in learner's own rows, so if the id and the session ever disagreed (a bug elsewhere), this would find nothing and
 * the save would be refused: the identity is checked twice, by two independent mechanisms, before the service role writes anything.
 */
async function hasConsent(client: SupabaseClient, userId: string): Promise<boolean | null> {
  const { data, error } = await client.from("consents").select("id").eq("user_id", userId).eq("kind", "cloud_storage").limit(1);
  return error ? null : (data?.length ?? 0) > 0;
}

async function readDoc(client: SupabaseClient, userId: string, key: DocKey): Promise<RemoteDoc | null | "error"> {
  const { data, error } = await client.from("learner_documents").select("revision, body, updated_at").eq("user_id", userId).eq("doc_key", key).maybeSingle();
  if (error) return "error";
  return data ? { revision: Number(data.revision), body: data.body as Record<string, unknown>, updatedAt: String(data.updated_at) } : null;
}

/** GET /api/sync/state: whether the learner has consented, and the revision of each saved document. No document bodies. */
export async function handleSyncState(d: SyncDeps): Promise<SyncResult> {
  const no = refuse(d.viewer);
  if (no) return no;
  const now = d.clock ?? Date.now;
  const t0 = now();
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  const consent = await hasConsent(d.client, d.viewer.id);
  const { data, error } = await d.client.from("learner_documents").select("doc_key, revision, updated_at").eq("user_id", d.viewer.id);
  if (consent === null || error) return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  const documents: SyncState["documents"] = { lessons_v2: null, guided_v1: null };
  for (const row of data ?? []) if (isDocKey(row.doc_key)) documents[row.doc_key] = { revision: Number(row.revision), updatedAt: String(row.updated_at) };
  return { status: 200, body: { consent, documents } satisfies SyncState, dbMs: now() - t0 };
}

/** GET /api/sync/documents/:key */
export async function handleSyncGet(d: SyncDeps, key: string): Promise<SyncResult> {
  const no = refuse(d.viewer);
  if (no) return no;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isDocKey(key)) return { status: 404, body: { error: "not_found" } };
  const now = d.clock ?? Date.now;
  const t0 = now();
  const doc = await readDoc(d.client, d.viewer.id, key);
  if (doc === "error") return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  return doc ? { status: 200, body: doc, dbMs: now() - t0 } : { status: 404, body: { error: "not_found" }, dbMs: now() - t0 };
}

/** PUT /api/sync/documents/:key: save one document, as a compare-and-swap from the revision the browser started from. */
export async function handleSyncPut(d: SyncDeps, key: string, raw: unknown, byteLength: number): Promise<SyncResult> {
  const no = refuse(d.viewer);
  if (no) return no;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isTrustedOrigin(d.headers, d.config.siteUrl)) return { status: 403, body: { error: "forbidden" } };
  if (!isDocKey(key)) return { status: 404, body: { error: "not_found" } };
  if (byteLength > MAX_DOC_BYTES + 1024) return { status: 413, body: { error: "too_large" } };
  const slow = await limited(d, LIMITS.sync, d.viewer.id);
  if (slow) return slow;

  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid_request" } };
  if (JSON.stringify(parsed.data.body).length > MAX_DOC_BYTES) return { status: 413, body: { error: "too_large" } };

  const consent = await hasConsent(d.client, d.viewer.id);
  if (consent === null) return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  if (!consent) return { status: 403, body: { error: "consent_required" } };

  const now = d.clock ?? Date.now;
  const t0 = now();
  const { data, error } = await d.service.rpc("put_document", { p_user: d.viewer.id, p_key: key, p_expected: parsed.data.expectedRevision, p_schema: DOC_SCHEMA[key], p_body: parsed.data.body });
  const dbMs = now() - t0;
  const row = (data as { ok: boolean; revision: number | string; error: string | null }[] | null)?.[0];
  if (error || !row) return { status: 503, body: { error: "unavailable" }, retryAfter: 30, dbMs };
  if (row.ok) return { status: 200, body: { revision: Number(row.revision) }, dbMs };
  switch (row.error) {
    case "conflict": {
      // Hand back what is stored now, so the browser can merge and try again without another round trip.
      const current = await readDoc(d.client, d.viewer.id, key);
      if (current && current !== "error") return { status: 409, body: { error: "conflict", revision: current.revision, body: current.body }, dbMs };
      return { status: 409, body: { error: "conflict", revision: Number(row.revision), body: null }, dbMs };
    }
    case "consent_required":
      return { status: 403, body: { error: "consent_required" }, dbMs };
    case "invalid":
      return { status: 422, body: { error: "invalid_document" }, dbMs };
    default:
      return { status: 500, body: { error: "save_failed" }, dbMs };
  }
}

/** POST /api/sync/consent: the learner agrees to keep their progress in their account. Nothing is uploaded by this call. */
export async function handleSyncConsent(d: SyncDeps, raw: unknown): Promise<SyncResult> {
  const no = refuse(d.viewer);
  if (no) return no;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isTrustedOrigin(d.headers, d.config.siteUrl)) return { status: 403, body: { error: "forbidden" } };
  const slow = await limited(d, LIMITS.consent, d.viewer.id);
  if (slow) return slow;
  if (!consentBody.safeParse(raw).success) return { status: 400, body: { error: "invalid_request" } };
  const { error } = await d.service.rpc("record_consent", { p_user: d.viewer.id, p_version: PRIVACY_NOTICE_VERSION });
  return error ? { status: 503, body: { error: "unavailable" }, retryAfter: 30 } : { status: 200, body: { consent: true } };
}
