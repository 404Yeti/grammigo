import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The flow cookie ties ONE browser to ONE sign-in attempt. It is signed (HMAC-SHA256), httpOnly, short-lived and single-use, and it
 * carries the invitation grant for a join. The `nonce` also travels in the OAuth redirect URL, so the callback accepts a sign-in
 * only when the cookie and the URL agree: a callback URL replayed into a different browser (login CSRF) has no matching cookie.
 *
 * The signature stops forgery; the database stops replay (a grant is redeemed once, by one user). Both are tested.
 */
export type FlowPayload = {
  v: 1;
  intent: "join" | "signin";
  nonce: string;
  /** The reservation id from `reserve_invitation`. Present only for a join. */
  grant?: string;
  /** When the learner confirmed they are 18 or older. Present only for a join. */
  adultAt?: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
};

const schema = z.strictObject({
  v: z.literal(1),
  intent: z.enum(["join", "signin"]),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  grant: z.uuid().optional(),
  adultAt: z.iso.datetime().optional(),
  exp: z.number().int().positive(),
});

const DOMAIN = "gm-flow-v1.";
const MAX_TOKEN_CHARS = 1024;

export const FLOW_TTL_SECONDS = 30 * 60; // matches the 30 minute reservation hold

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (body: string, secret: Buffer) => createHmac("sha256", secret).update(DOMAIN + body).digest();

export function newNonce(): string {
  return b64(randomBytes(24));
}

export function signFlow(payload: FlowPayload, secret: Buffer): string {
  const body = b64(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64(mac(body, secret))}`;
}

/** Returns the payload, or null for ANYTHING wrong: shape, signature, expiry, size. It never throws. */
export function verifyFlow(token: string | undefined | null, secret: Buffer, nowSeconds: number): FlowPayload | null {
  if (!token || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return null;
  const p = result.data;
  if (p.exp <= nowSeconds) return null;
  if (p.intent === "join" && (!p.grant || !p.adultAt)) return null;
  if (p.intent === "signin" && (p.grant || p.adultAt)) return null;
  return p;
}

/** Constant-time string equality for secrets and nonces. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
