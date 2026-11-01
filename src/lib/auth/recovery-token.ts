/** The shape of the one-time token in a password-reset email (URL-safe characters only, bounded). Shared by the server and the reset page. */
export const RECOVERY_TOKEN = /^[A-Za-z0-9_-]{16,200}$/;
