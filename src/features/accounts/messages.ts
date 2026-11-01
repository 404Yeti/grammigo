import type { JoinError } from "@/lib/auth/constants";

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
};

export const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Nothing was changed.",
  state: "That sign-in link has expired or was opened somewhere else. Please start again from Grammigo.",
  exchange: "We couldn’t finish signing you in. Please try again.",
  identity: "We couldn’t sign you in with that Google account.",
  unverified: "Google hasn’t verified the email address on that account, so we can’t use it.",
  suspended: "This account can’t sign in right now.",
  server: "Something went wrong on our side. Nothing was saved. Please try again in a moment.",
  reauth: "That Google account isn’t the one you were signed in with, so we couldn’t confirm it was you. Nothing was changed. Please sign in again.",
};
