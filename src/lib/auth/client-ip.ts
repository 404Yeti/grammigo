import { createHmac } from "node:crypto";

/**
 * The client address used ONLY to key rate limits. On Vercel, `x-vercel-forwarded-for` and `x-real-ip` are set by the platform and
 * cannot be forged by the client. `x-forwarded-for` is a last resort (a client can prepend values to it), so off-platform the limit
 * is weaker; it is never used for authorisation. The address is HMAC-hashed before it goes anywhere near a database.
 */
export function clientAddress(headers: Headers): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  return first(headers.get("x-vercel-forwarded-for")) ?? first(headers.get("x-real-ip")) ?? first(headers.get("x-forwarded-for")) ?? "unknown";
}

/** A 32 byte bucket key: HMAC(secret, namespace + subject). Namespacing keeps one endpoint's budget separate from another's. */
export function bucketKey(secret: Buffer, namespace: string, subject: string): Buffer {
  return createHmac("sha256", secret).update(`gm-rl-v1:${namespace}:${subject}`).digest();
}
