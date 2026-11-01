/** The privacy notice version recorded with a learner's consent. The notice is still a DRAFT until professional legal review. */
export const PRIVACY_NOTICE_VERSION = "draft-2026-10";

/** Where each outcome of the sign-in callback leads. Pages show a fixed message for each code; nothing user-supplied is echoed. */
export const AUTH_ERROR_REASONS = ["cancelled", "state", "exchange", "identity", "unverified", "suspended", "server"] as const;
export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

export const JOIN_ERRORS = ["invite", "expired", "revoked", "full", "adult", "rate", "server", "state"] as const;
export type JoinError = (typeof JOIN_ERRORS)[number];
