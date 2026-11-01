// Export and deletion for a SUSPENDED learner, done by the owner on their own machine after the identity steps in docs/dev/suspended-requests.md.
// A suspended learner cannot use the app's self-service export or deletion (row-level security shows them nothing), and this tool does NOT
// change that: it never sets the status back to active, never creates a session, never prints a record. It refuses anything that is not
// currently a suspended, non-owner learner, so it cannot be used to read or delete an ordinary active account (those use the app).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/** The notice version the application is built with, read from its one source of truth, so the two exports cannot disagree. */
const noticeVersion = () => /PRIVACY_NOTICE_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../src/lib/auth/constants.ts", import.meta.url), "utf8"))?.[1] ?? "unknown";

/** MUST equal ledgerHash() in src/lib/auth/lifecycle.ts (tested). */
export const ledgerHash = (userId, pepper) => createHmac("sha256", Buffer.from(pepper, "utf8")).update(`gm-deleted-v1:${userId.toLowerCase()}`).digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds the account for an email address and says ONLY whether it is a suspended learner. Prints no email, name or record. */
export async function findSuspended(service, email) {
  const wanted = String(email).trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("could not list users");
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return suspendedState(service, hit.id);
    if (data.users.length < 200) break;
  }
  return { found: false };
}

async function suspendedState(service, id) {
  const profile = await service.from("profiles").select("status").eq("id", id).maybeSingle();
  if (profile.error) throw new Error("could not read the profile");
  const admin = await service.from("app_admins").select("user_id").eq("user_id", id).maybeSingle();
  return { found: true, id, suspended: profile.data?.status === "suspended", owner: !!admin.data };
}

async function requireSuspended(service, id) {
  if (!UUID.test(id)) throw new Error("the user must be an account id");
  const s = await suspendedState(service, id);
  if (!s.suspended || s.owner) throw new Error("refused: that account is not a suspended, non-owner learner (active learners use the app's own export and deletion)");
}

/** The same content and shape as the app's own export (a test compares them), read with the service role for ONE named suspended account. */
export async function exportSuspended(service, id, now = new Date()) {
  await requireSuspended(service, id);
  const [profile, consents, docs, user] = await Promise.all([
    service.from("profiles").select("display_name, first_language, time_zone, preferences, adult_confirmed_at, created_at, updated_at").eq("id", id).maybeSingle(),
    service.from("consents").select("kind, version, accepted_at").eq("user_id", id).order("accepted_at"),
    service.from("learner_documents").select("doc_key, schema_version, revision, updated_at, body").eq("user_id", id).order("doc_key"),
    service.auth.admin.getUserById(id),
  ]);
  if (profile.error || consents.error || docs.error || !profile.data) throw new Error("could not read the account");
  const p = profile.data;
  await service.rpc("audit_export", { p_user: id });
  return {
    format: "grammigo-account-export",
    version: 1,
    generatedAt: now.toISOString(),
    noticeVersion: noticeVersion(),
    account: { id, email: user.data?.user?.email ?? null },
    profile: { displayName: p.display_name, firstLanguage: p.first_language ?? null, timeZone: p.time_zone ?? null, preferences: p.preferences, confirmedAdultAt: p.adult_confirmed_at, createdAt: p.created_at, updatedAt: p.updated_at },
    consents: (consents.data ?? []).map((c) => ({ kind: String(c.kind), version: String(c.version), acceptedAt: String(c.accepted_at) })),
    progress: (docs.data ?? []).map((r) => ({ document: String(r.doc_key), schemaVersion: Number(r.schema_version), revision: Number(r.revision), updatedAt: String(r.updated_at), body: r.body })),
  };
}

/** Deletes a suspended learner exactly as self-service does (one transaction: ledger entry, audit row, delete). Does not restore access. */
export async function deleteSuspended(service, id, pepper) {
  await requireSuspended(service, id);
  if (!pepper || pepper.length < 32) throw new Error("INVITE_CODE_PEPPER (the app's value) is needed so the deletion is recorded in the ledger");
  const { error } = await service.rpc("delete_learner", { p_user: id, p_user_hash: `\\x${ledgerHash(id, pepper).toString("hex")}` });
  if (error) throw new Error("the database refused the deletion");
}
