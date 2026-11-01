/** The privacy notice version recorded with a learner's consent. The notice is still a DRAFT until professional legal review. */
export const PRIVACY_NOTICE_VERSION = "draft-2026-11";

/** How recent a sign-in must be to delete an account (seconds). The environment may only SHORTEN it, never lengthen it (see config.ts). */
export const REAUTH_WINDOW_SECONDS = 600;

/** The words a learner types to confirm deleting their account. Compared after trimming and lower-casing. */
export const DELETE_CONFIRM_PHRASE = "delete my account";

/** Where each outcome of the sign-in callback leads. Pages show a fixed message for each code; nothing user-supplied is echoed. */
export const AUTH_ERROR_REASONS = ["cancelled", "state", "exchange", "identity", "unverified", "suspended", "server", "reauth"] as const;
export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

export const JOIN_ERRORS = ["invite", "expired", "revoked", "full", "adult", "rate", "server", "state"] as const;
export type JoinError = (typeof JOIN_ERRORS)[number];
