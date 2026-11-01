import { z } from "zod";

/**
 * Password rules, applied by OUR server before anything reaches Supabase Auth (which stores and checks passwords; Grammigo never does).
 * Length is counted in characters for the minimum and in BYTES for the maximum, because bcrypt (used by Supabase) only reads the first 72 bytes:
 * a longer password would silently lose its tail. There are no composition rules (they push people to predictable patterns); instead the
 * obviously bad ones are refused: too short, built from one repeated character, equal to the address, or on a short list of the most common choices.
 * Supabase's own minimum-length and character-class settings (dashboard) apply in addition, and its sign-in rate limits and ours both apply.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;

const COMMON = new Set([
  "password1234", "123456789012", "qwertyuiop12", "passwordpassword", "iloveyou1234", "letmein12345", "welcome12345", "administrator", "1234567890123",
  "password12345", "qwerty123456", "abc123abc123", "grammigo1234", "grammigogrammigo", "changeme1234", "000000000000", "111111111111",
]);

export type PasswordProblem = "short" | "long" | "repeated" | "common" | "email";

export function passwordProblem(password: string, email: string): PasswordProblem | null {
  if (typeof password !== "string") return "short";
  if ([...password].length < PASSWORD_MIN) return "short";
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return "long";
  if (new Set([...password]).size <= 2) return "repeated";
  const lower = password.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (lower === email.toLowerCase() || (local.length >= 6 && lower.includes(local))) return "email";
  if (COMMON.has(lower)) return "common";
  return null;
}

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  short: `Use at least ${PASSWORD_MIN} characters. A few random words is a good way to do it.`,
  long: "That password is too long (the limit is 72 bytes). Please use a shorter one.",
  repeated: "That password is too simple. Use a mix of different characters or several random words.",
  common: "That is one of the most common passwords. Please choose another.",
  email: "Please don’t use your email address in your password.",
};

/** The same address however it is typed: trimmed, lower-cased, one at-sign, a sensible length. Null if it can't be an address. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return null;
  return z.email().safeParse(e).success ? e : null;
}
