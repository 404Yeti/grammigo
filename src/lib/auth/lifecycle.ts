import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientAddress } from "./client-ip";
import type { AuthConfig } from "./config";
import { DELETE_CONFIRM_PHRASE, PRIVACY_NOTICE_VERSION } from "./constants";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS, type LimitRule, type RateLimitStore } from "./rate-limit";
import type { Viewer } from "./viewer";

/**
 * The end of an account's life: downloading everything it holds, and deleting it.
 *
 * EXPORT reads only through the learner's OWN session client, so row-level security decides what is returned: there is no service role in
 * the read path and no way to name another learner. The only privileged call is a one-line audit record that an export happened.
 *
 * DELETE needs the service role for exactly one thing: a database function that writes the ledger entry and deletes the Auth user in ONE
 * transaction (the user's profile, consents, documents and revisions, sessions and Google identity all go with it). Before that, it requires:
 *   - an active learner who is not the owner,
 *   - a same-origin request (CSRF), within a rate limit,
 *   - the confirmation words typed by the person,
 *   - a RECENT sign-in (a stolen or left-open session alone cannot delete an account).
 * The learner's id comes from the verified session, never from the request.
 */
export type LifecycleDeps = {
  config: AuthConfig;
  viewer: Viewer;
  /** The learner's own client (row-level security applies). */
  client: SupabaseClient;
  /** Service role. Used for the audit record and the deletion function, nothing else. */
  service: SupabaseClient;
  limiter: RateLimitStore;
  headers: Headers;
  /** When this session last proved who the person is, in seconds since the epoch (null if unknown, which counts as not recent). */
  signedInAt: number | null;
  now(): number;
  log(event: string, fields?: Record<string, string | number | boolean>): void;
  /** Ends this browser's session cookies. Called after a successful deletion. */
  endSession(): void;
};

export type LifecycleResult = { status: number; body: unknown; retryAfter?: number; download?: { filename: string } };

const MAX_BODY_BYTES = 1024;

function refuse(viewer: Viewer): LifecycleResult | null {
  if (viewer.kind === "learner") return null;
  if (viewer.kind === "unavailable") return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  return viewer.kind === "anonymous" ? { status: 401, body: { error: "unauthenticated" } } : { status: 403, body: { error: "forbidden" } };
}

async function limited(d: LifecycleDeps, rules: LimitRule[], id: string): Promise<LifecycleResult | null> {
  try {
    const decision = await checkLimits(d.limiter, d.config.flowSecret, rules, `${id}:${clientAddress(d.headers)}`);
    return decision.allowed ? null : { status: 429, body: { error: "rate_limited" }, retryAfter: decision.retryAfter };
  } catch {
    return { status: 503, body: { error: "unavailable" }, retryAfter: 30 }; // fail closed
  }
}

// ---------------------------------------------------------------- recent sign-in

/** The newest authentication time in a session's `amr` claim (seconds), or null. The `iat` of the access token is NOT used: it moves on every refresh. */
export function latestAuthentication(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let best: number | null = null;
  for (const e of amr) {
    const t = e && typeof e === "object" ? (e as { timestamp?: unknown }).timestamp : undefined;
    if (typeof t === "number" && Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

/** True only if the sign-in is within the window and not from the future (a clock that is wrong is not a reason to trust a time). */
export function isRecentSignIn(signedAt: number | null, nowMs: number, windowSeconds: number): boolean {
  if (signedAt === null) return false;
  const age = nowMs / 1000 - signedAt;
  return age >= -60 && age <= windowSeconds;
}

/** Asks the Auth server to verify the session, then reads when the person last signed in. Any failure is "unknown", which counts as not recent. */
export async function readSignedInAt(client: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await client.auth.getClaims();
    if (error || !data) return null;
    return latestAuthentication((data.claims as { amr?: unknown }).amr);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the deletion ledger's key

/**
 * What the deletion ledger stores in place of a person: HMAC-SHA256 of the account id under the server secret, domain-separated. Not reversible
 * without the secret, and useless without it. After a backup is restored, hashing the ids that exist and matching them against the ledger
 * finds the people who must be deleted again (see replayDeletionLedger).
 */
export function ledgerHash(userId: string, pepper: Buffer): Buffer {
  return createHmac("sha256", pepper).update(`gm-deleted-v1:${userId.toLowerCase()}`).digest();
}
const hex = (b: Buffer) => `\\x${b.toString("hex")}`;

// ---------------------------------------------------------------- export

export type AccountExport = {
  format: "grammigo-account-export";
  version: 1;
  generatedAt: string;
  noticeVersion: string;
  account: { id: string; email: string | null };
  profile: Record<string, unknown> | null;
  consents: { kind: string; version: string; acceptedAt: string }[];
  progress: { document: string; schemaVersion: number; revision: number; updatedAt: string; body: unknown }[];
  notIncluded: string[];
};

const NOT_INCLUDED = [
  "Earlier saved versions of your progress (the account keeps the newest 10 for recovery; the export has the current version).",
  "Anything that is only on your devices and was never saved to your account (use “Download a copy of my progress” on that device).",
  "Counts and records that do not identify you: invitation use counts, request-rate counters, and the log that an export or deletion happened.",
  "Your Google account itself. Grammigo never receives your Google password.",
];

/** Everything the account holds about the signed-in learner, read through their own session. */
export async function buildExport(d: LifecycleDeps, userId: string): Promise<AccountExport | null> {
  const [profile, consents, docs, user] = await Promise.all([
    d.client.from("profiles").select("display_name, first_language, time_zone, preferences, adult_confirmed_at, created_at, updated_at").eq("id", userId).maybeSingle(),
    d.client.from("consents").select("kind, version, accepted_at").eq("user_id", userId).order("accepted_at"),
    d.client.from("learner_documents").select("doc_key, schema_version, revision, updated_at, body").eq("user_id", userId).order("doc_key"),
    d.client.auth.getUser(),
  ]);
  if (profile.error || consents.error || docs.error || !profile.data) return null;
  const p = profile.data as Record<string, unknown>;
  return {
    format: "grammigo-account-export",
    version: 1,
    generatedAt: new Date(d.now()).toISOString(),
    noticeVersion: PRIVACY_NOTICE_VERSION,
    account: { id: userId, email: user.data.user?.email ?? null },
    profile: {
      displayName: p.display_name,
      firstLanguage: p.first_language ?? null,
      timeZone: p.time_zone ?? null,
      preferences: p.preferences,
      confirmedAdultAt: p.adult_confirmed_at,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    },
    consents: (consents.data ?? []).map((c) => ({ kind: String(c.kind), version: String(c.version), acceptedAt: String(c.accepted_at) })),
    progress: (docs.data ?? []).map((r) => ({ document: String(r.doc_key), schemaVersion: Number(r.schema_version), revision: Number(r.revision), updatedAt: String(r.updated_at), body: r.body })),
    notIncluded: NOT_INCLUDED,
  };
}

export async function handleExport(d: LifecycleDeps): Promise<LifecycleResult> {
  const denied = refuse(d.viewer);
  if (denied) return denied;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isTrustedOrigin(d.headers, d.config.siteUrl)) return { status: 403, body: { error: "forbidden" } };
  const slowed = await limited(d, LIMITS.export, d.viewer.id);
  if (slowed) return slowed;

  const out = await buildExport(d, d.viewer.id);
  if (!out) return { status: 503, body: { error: "unavailable" }, retryAfter: 30 };
  try {
    await d.service.rpc("audit_export", { p_user: d.viewer.id }); // the fact that an export happened; never its content
  } catch {
    // the learner still gets their data; the audit row is best effort
  }
  d.log("export", { outcome: "ok" });
  return { status: 200, body: out, download: { filename: `grammigo-my-data-${new Date(d.now()).toISOString().slice(0, 10)}.json` } };
}

// ---------------------------------------------------------------- delete

const deleteBody = z.strictObject({ confirm: z.string().max(100) });
export const normaliseConfirmation = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function handleDelete(d: LifecycleDeps, raw: unknown): Promise<LifecycleResult> {
  const denied = refuse(d.viewer);
  if (denied) return denied;
  if (d.viewer.kind !== "learner") return { status: 403, body: { error: "forbidden" } };
  if (!isTrustedOrigin(d.headers, d.config.siteUrl)) return { status: 403, body: { error: "forbidden" } };
  if (Number(d.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { status: 413, body: { error: "too_large" } };
  if (d.viewer.isAdmin) return { status: 409, body: { error: "owner_account" } }; // the owner is removed deliberately, by hand
  const slowed = await limited(d, LIMITS.delete, d.viewer.id);
  if (slowed) return slowed;

  const parsed = deleteBody.safeParse(raw);
  if (!parsed.success || normaliseConfirmation(parsed.data.confirm) !== DELETE_CONFIRM_PHRASE) return { status: 400, body: { error: "confirmation" } };
  if (!isRecentSignIn(d.signedInAt, d.now(), d.config.reauthWindowSeconds)) return { status: 403, body: { error: "reauth_required" } };

  // One transaction in the database: the ledger entry, the audit row and the deletion happen together or not at all.
  const { error } = await d.service.rpc("delete_learner", { p_user: d.viewer.id, p_user_hash: hex(ledgerHash(d.viewer.id, d.config.pepper)) });
  if (error) {
    d.log("delete", { outcome: "failed" });
    return { status: 500, body: { error: "delete_failed" } };
  }
  d.endSession(); // the Auth user is gone, so every session of theirs is already invalid; this clears this browser's cookies too
  d.log("delete", { outcome: "ok" });
  return { status: 200, body: { deleted: true } };
}

// ---------------------------------------------------------------- restore safety

export interface ReplayDb {
  allUserIds(): Promise<string[]>;
  ledgerHashes(): Promise<Buffer[]>;
  redelete(userId: string): Promise<boolean>;
}

/**
 * After a backup restore: deletes every account whose hash is in the deletion ledger. Idempotent (running it again deletes nothing more) and
 * safe by construction: it only ever deletes ids whose keyed hash matches an entry, and the database refuses to delete an owner.
 * With the WRONG key nothing matches and nothing is deleted, which the caller can see from `deleted: 0` against a non-empty ledger.
 */
export async function replayDeletionLedger(db: ReplayDb, pepper: Buffer): Promise<{ checked: number; ledger: number; deleted: number }> {
  const [ids, hashes] = await Promise.all([db.allUserIds(), db.ledgerHashes()]);
  const wanted = new Set(hashes.map((h) => h.toString("hex")));
  let deleted = 0;
  for (const id of ids) if (wanted.has(ledgerHash(id, pepper).toString("hex")) && (await db.redelete(id))) deleted++;
  return { checked: ids.length, ledger: hashes.length, deleted };
}

export function serviceReplayDb(service: SupabaseClient): ReplayDb {
  const fromHex = (v: unknown) => Buffer.from(String(v).replace(/^\\x/, ""), "hex");
  return {
    async allUserIds() {
      const r = await service.rpc("all_user_ids");
      if (r.error) throw new Error("all_user_ids failed");
      return (r.data as string[]) ?? [];
    },
    async ledgerHashes() {
      const r = await service.rpc("ledger_hashes");
      if (r.error) throw new Error("ledger_hashes failed");
      return ((r.data as unknown[]) ?? []).map(fromHex);
    },
    async redelete(userId) {
      const r = await service.rpc("redelete_learner", { p_user: userId });
      if (r.error) throw new Error("redelete failed");
      return r.data === true;
    },
  };
}
