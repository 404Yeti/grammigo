import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientAddress } from "./client-ip";
import { codeHint, formatCode, generateCode, hashCode } from "./invite-code";
import { isTrustedOrigin } from "./origin";
import { checkLimits, LIMITS, type RateLimitStore } from "./rate-limit";
import type { AuthConfig } from "./config";
import type { Viewer } from "./viewer";

/**
 * Owner-only invitation management. Every call requires (1) a verified session of (2) an ACTIVE learner who is (3) in app_admins,
 * (4) a same-origin request, and (5) stays inside a per-admin rate limit. The plaintext code exists only in the response to its
 * creation: the database keeps an HMAC, so it can never be shown again.
 */
export type AdminDeps = {
  config: AuthConfig;
  viewer: Viewer;
  service: SupabaseClient;
  limiter: RateLimitStore;
  headers: Headers;
  now(): number;
};

export type AdminResult = { status: number; body: unknown; retryAfter?: number };

const createSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  maxUses: z.number().int().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

const deny = (status: 401 | 403 | 429): AdminResult => ({ status, body: { error: status === 401 ? "unauthenticated" : status === 429 ? "rate_limited" : "forbidden" } });

async function gate(d: AdminDeps, mutating: boolean): Promise<AdminResult | null> {
  if (d.viewer.kind === "anonymous") return deny(401);
  if (d.viewer.kind !== "learner" || !d.viewer.isAdmin) return deny(403);
  if (mutating && !isTrustedOrigin(d.headers, d.config.siteUrl)) return deny(403);
  try {
    const decision = await checkLimits(d.limiter, d.config.flowSecret, LIMITS.admin, `${d.viewer.id}:${clientAddress(d.headers)}`);
    if (!decision.allowed) return { ...deny(429), retryAfter: decision.retryAfter };
  } catch {
    return { status: 503, body: { error: "unavailable" } };
  }
  return null;
}

export async function createInvitation(d: AdminDeps, raw: unknown): Promise<AdminResult> {
  const refused = await gate(d, true);
  if (refused) return refused;
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid_request" } };
  const { label, maxUses, expiresInDays } = parsed.data;
  const code = generateCode();
  const expiresAt = new Date(d.now() + expiresInDays * 86_400_000).toISOString();
  const { data, error } = await d.service.rpc("create_invitation", {
    p_label: label,
    p_code_hash: `\\x${hashCode(code, d.config.pepper).toString("hex")}`,
    p_hint: codeHint(code),
    p_max_uses: maxUses,
    p_expires_at: expiresAt,
    p_actor: d.viewer.kind === "learner" ? d.viewer.id : null,
  });
  if (error) return { status: 500, body: { error: "create_failed" } };
  return { status: 201, body: { id: data, code: formatCode(code), hint: codeHint(code), label, maxUses, expiresAt } };
}

export async function listInvitations(d: AdminDeps): Promise<AdminResult> {
  const refused = await gate(d, false);
  if (refused) return refused;
  // Explicit columns: the code hash is never selected, so it can never be returned.
  const { data, error } = await d.service
    .from("invitations")
    .select("id,label,code_hint,max_uses,reserved_count,redeemed_count,expires_at,revoked_at,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { status: 500, body: { error: "list_failed" } };
  return { status: 200, body: { invitations: data } };
}

export async function revokeInvitation(d: AdminDeps, id: string): Promise<AdminResult> {
  const refused = await gate(d, true);
  if (refused) return refused;
  if (!z.uuid().safeParse(id).success) return { status: 400, body: { error: "invalid_request" } };
  const { error } = await d.service.rpc("revoke_invitation", { p_id: id, p_actor: d.viewer.kind === "learner" ? d.viewer.id : null });
  if (error) return { status: 500, body: { error: "revoke_failed" } };
  return { status: 200, body: { revoked: true } };
}
