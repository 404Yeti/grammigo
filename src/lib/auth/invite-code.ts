import { createHmac, randomInt } from "node:crypto";

/**
 * Invitation codes: 10 characters from a 32 symbol alphabet with no look-alikes (no 0/O, 1/I/L), about 50 bits of entropy.
 * Only the HMAC of a code is stored, keyed by a server-side pepper, so a copy of the database cannot be used to guess codes offline.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 symbols; see CODE_LENGTH for the entropy
export const CODE_LENGTH = 11; // 31^11 is about 2^54.5
const NORMALISED = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)]; // randomInt is uniform: no modulo bias
  return out;
}

/** Shows a code the way a person copies it: GRAM-MIGO-123. */
export function formatCode(code: string): string {
  return code.replace(/^(.{4})(.{4})(.*)$/, "$1-$2-$3");
}

/** Accepts what a person might paste (spaces, dashes, lower case). Returns null if it cannot be a code, without touching the database. */
export function normaliseCode(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  return NORMALISED.test(cleaned) ? cleaned : null;
}

export function hashCode(code: string, pepper: Buffer): Buffer {
  return createHmac("sha256", pepper).update(`gm-invite-v1:${code}`).digest();
}

/** The last four characters, stored so the owner can tell invitations apart without storing the code. */
export function codeHint(code: string): string {
  return code.slice(-4);
}
