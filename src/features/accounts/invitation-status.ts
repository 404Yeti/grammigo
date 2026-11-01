/** Owner invitation list: how a row from the API is described. Pure, so the list, the revoke screen and the tests agree. */
export type InvitationRow = {
  id: string;
  label: string;
  /** The last four characters of the code. The rest cannot be recovered: only a keyed hash is stored. */
  code_hint: string;
  max_uses: number;
  reserved_count: number;
  redeemed_count: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type InvitationStatus = "active" | "full" | "expired" | "revoked";

/** Strongest reason first: a revoked invitation is "revoked" even if it has also expired or filled up. */
export function statusOf(row: InvitationRow, now: number): InvitationStatus {
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (row.reserved_count >= row.max_uses) return "full";
  return "active";
}

export const usedPercent = (row: InvitationRow) => Math.min(100, Math.round((row.redeemed_count / Math.max(1, row.max_uses)) * 100));

const DAY = 86_400_000;
export function expiryText(row: InvitationRow, now: number): string {
  const at = new Date(row.expires_at).getTime();
  const days = Math.round(Math.abs(at - now) / DAY);
  if (row.revoked_at) return "revoked";
  if (at > now) return days === 0 ? "expires today" : `expires in ${days} ${days === 1 ? "day" : "days"}`;
  return days === 0 ? "ended today" : `ended ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Only an active invitation can be revoked or expired from the list. */
export const canManage = (s: InvitationStatus) => s === "active" || s === "full";
export const canExpire = (s: InvitationStatus) => s === "active" || s === "full";

/** The shareable link. The code goes in the URL FRAGMENT (after #): browsers never send it to a server, so it stays out of access logs and Referer headers. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/join#c=${encodeURIComponent(code.replaceAll("-", ""))}`;
}

/** Reads a code out of a link fragment. Returns null for anything that is not a plain code. */
export function codeFromHash(hash: string): string | null {
  const m = /^#c=([A-Za-z0-9]{8,24})$/.exec(hash);
  return m ? m[1].toUpperCase() : null;
}
