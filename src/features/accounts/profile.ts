import { z } from "zod";

/**
 * What a learner may store on their profile, and the only rules for it. Pure (no server code), so the edit form and the server
 * validate against the SAME schema. The server never trusts the form: it parses the request again with this.
 *
 * Learning goals and preferences live in the profile's `preferences` JSON. They are NOT fed into lesson recommendations in this
 * release (that would change how recommendations work); they are shown back to the learner and will be applied when progress syncs.
 */
export const DAILY_MINUTES = [5, 10, 15] as const;
export type DailyMinutes = (typeof DAILY_MINUTES)[number];
export const MAX_PRACTISING = 8;
export const NAME_MAX = 40;
export const LANGUAGE_MAX = 40;

export type Preferences = { v: 1; practising: string[]; dailyMinutes: DailyMinutes };
export const DEFAULT_PREFERENCES: Preferences = { v: 1, practising: [], dailyMinutes: 10 };

// Control characters, and the bidirectional overrides that can make a name read differently from how it is stored.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩​-‏﻿]/;
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const nameSchema = z
  .string()
  .transform(collapse)
  .pipe(z.string().min(1, "name_required").max(NAME_MAX, "name_too_long"))
  .refine((s) => !FORBIDDEN.test(s), "name_invalid");

const languageSchema = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null ? null : collapse(v)))
  .pipe(z.union([z.string().max(LANGUAGE_MAX, "language_too_long"), z.null()]))
  .refine((v) => v === null || !FORBIDDEN.test(v), "language_invalid")
  .transform((v) => (v === "" ? null : v));

export function profileUpdateSchema(topics: readonly string[]) {
  const allowed = new Set(topics);
  return z.strictObject({
    displayName: nameSchema,
    firstLanguage: languageSchema,
    practising: z
      .array(z.string())
      .max(MAX_PRACTISING, "too_many_goals")
      .refine((a) => a.every((t) => allowed.has(t)), "unknown_goal")
      .refine((a) => new Set(a).size === a.length, "duplicate_goal"),
    dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  });
}
export type ProfileUpdate = z.infer<ReturnType<typeof profileUpdateSchema>>;

/** Reads stored preferences defensively: anything unexpected falls back to defaults instead of breaking the page. */
export function parsePreferences(raw: unknown, topics: readonly string[]): Preferences {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_PREFERENCES;
  const r = raw as Record<string, unknown>;
  const allowed = new Set(topics);
  const practising = Array.isArray(r.practising) ? [...new Set(r.practising.filter((t): t is string => typeof t === "string" && allowed.has(t)))].slice(0, MAX_PRACTISING) : [];
  const dailyMinutes = DAILY_MINUTES.find((m) => m === r.dailyMinutes) ?? DEFAULT_PREFERENCES.dailyMinutes;
  return { v: 1, practising, dailyMinutes };
}

/** What the server stores for an accepted update. */
export const toRow = (u: ProfileUpdate) => ({
  display_name: u.displayName,
  first_language: u.firstLanguage,
  preferences: { v: 1, practising: u.practising, dailyMinutes: u.dailyMinutes } satisfies Preferences,
});

export type ProfileView = {
  displayName: string;
  firstLanguage: string | null;
  preferences: Preferences;
  /** ISO time the account was created. */
  memberSince: string;
  /** From the verified Auth identity; shown only to its owner. */
  email: string | null;
};

/** Field-level error codes → plain words. Nothing from the request is echoed. */
export const PROFILE_ERRORS: Record<string, string> = {
  name_required: "Please enter a name.",
  name_too_long: `Names can be up to ${NAME_MAX} characters.`,
  name_invalid: "That name has characters we can’t use.",
  language_too_long: `Please keep this to ${LANGUAGE_MAX} characters.`,
  language_invalid: "That has characters we can’t use.",
  too_many_goals: `Pick up to ${MAX_PRACTISING} topics.`,
  unknown_goal: "One of those topics isn’t available.",
  duplicate_goal: "A topic was picked twice.",
  invalid: "Something in the form isn’t right. Please check it and try again.",
};

/** Maps a zod failure to ONE code per field (never the submitted text). */
export function errorCodes(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (out[field]) continue;
    out[field] = Object.hasOwn(PROFILE_ERRORS, issue.message) ? issue.message : "invalid";
  }
  return out;
}
