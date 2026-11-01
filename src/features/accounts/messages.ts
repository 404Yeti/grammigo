import type { JoinError } from "@/lib/auth/constants";
import { PASSWORD_MESSAGES } from "@/lib/auth/password-policy";

/** Fixed copy for each code. Nothing from the URL is ever echoed back, so a crafted link cannot put words in our mouth. */
export const JOIN_MESSAGES: Record<JoinError, string> = {
  invite: "That invitation code isn’t valid. Check it and try again, or ask for a new one.",
  expired: "This invitation has expired. Ask for a new one.",
  revoked: "This invitation has been withdrawn. Ask for a new one.",
  full: "This invitation has no places left. Ask for a new one.",
  adult: "Please confirm you are 18 or older to continue.",
  rate: "Too many tries. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Nothing was saved. Please try again in a moment.",
  state: "That sign-in didn’t finish. Please start again.",
};

export const SIGNIN_MESSAGES: Record<string, string> = {
  session: "Your session ended. Please sign in again.",
  rate: "Too many tries. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Please try again in a moment.",
  credentials: "That email address and password don’t match. Check them and try again.",
  unconfirmed: "Please confirm your email address first: open the link in the email we sent you, then sign in.",
  noaccount: "There is no account for that address yet. Accounts are by invitation, and nothing was created.",
  linked: "This address is connected to more than one way of signing in, so we can’t sign you in. Use the method you joined with.",
  suspended: "This account can’t sign in right now.",
  pwchanged: "Your password was changed and you were signed out everywhere. Sign in with the new one.",
};

/** The email + password registration form. Fixed wording per code; nothing from the URL is echoed. */
export const REGISTER_MESSAGES: Record<string, string> = {
  ...JOIN_MESSAGES,
  email: "That doesn’t look like an email address. Check it and try again.",
  taken: "That email address can’t be used to join here. If you already have an account, sign in instead.",
  pw_short: PASSWORD_MESSAGES.short,
  pw_long: PASSWORD_MESSAGES.long,
  pw_repeated: PASSWORD_MESSAGES.repeated,
  pw_common: PASSWORD_MESSAGES.common,
  pw_email: PASSWORD_MESSAGES.email,
};

export const NEW_PASSWORD_MESSAGES: Record<string, string> = {
  rate: "Too many tries. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Your password was not changed. Please try again.",
  mismatch: "The two passwords don’t match.",
  same: "That is your current password. Choose a new one.",
  pw_short: PASSWORD_MESSAGES.short,
  pw_long: PASSWORD_MESSAGES.long,
  pw_repeated: PASSWORD_MESSAGES.repeated,
  pw_common: PASSWORD_MESSAGES.common,
  pw_email: PASSWORD_MESSAGES.email,
};

export const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Nothing was changed.",
  state: "That sign-in link has expired or was opened somewhere else. Please start again from Grammigo.",
  exchange: "We couldn’t finish signing you in. Please try again.",
  identity: "We couldn’t sign you in with that Google account.",
  unverified: "Google hasn’t verified the email address on that account, so we can’t use it.",
  suspended: "This account can’t sign in right now.",
  server: "Something went wrong on our side. Nothing was saved. Please try again in a moment.",
  recover: "That reset link didn’t work. Each link works once and for an hour; ask for a new one and use the newest email.",
  reauth: "That isn’t the Google account you were signed in with, so we did not continue. Nothing was changed. Please sign in again.",
};
