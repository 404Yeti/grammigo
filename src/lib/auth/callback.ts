import { PRIVACY_NOTICE_VERSION, type AuthErrorReason } from "./constants";
import { safeEqual, verifyFlow } from "./flow";
import { checkGoogleIdentity, displayNameFrom } from "./identity";
import type { AuthRuntime } from "./runtime";

export type CallbackOutcome =
  | "signed_in"
  | "reauthenticated"
  | "joined"
  | "no_account"
  | "invite_unusable"
  | "cancelled"
  | "state"
  | "exchange"
  | "identity"
  | "unverified"
  | "suspended"
  | "server";

export type CallbackResult = { redirect: string; outcome: CallbackOutcome };

export type CallbackInput = {
  code: string | null;
  /** `error` from the provider redirect (the person pressed Cancel, or Google refused). */
  providerError: string | null;
  /** The `flow` nonce that came back in the redirect URL. */
  flowParam: string | null;
};

const errorPage = (reason: AuthErrorReason) => `/auth/error?r=${reason}`;

/**
 * The sign-in callback. This is the one place a Google identity becomes (or does not become) a Grammigo learner.
 *
 * Rules, in order:
 *  1. The signed flow cookie must verify, and its nonce must equal the one in the URL. Otherwise nothing is exchanged.
 *  2. The one-time code is exchanged for a session (Supabase checks the PKCE verifier and its own state here).
 *  3. The user is re-fetched from the Auth server and must be a Google-only identity with a verified email (no account linking).
 *  4. An ACTIVE profile means a returning learner: signed in. A suspended profile is refused.
 *  5. No profile: only a valid invitation grant from this very flow can create one, atomically (`redeem_invitation`).
 *  6. Anything else is refused, the session is cleared and the profile-less identity is deleted. If the deletion fails nothing
 *     changes for security: an identity without a profile has no access (see `is_active_learner`), and a nightly job retries.
 *
 * The flow cookie is single-use: it is cleared at the start whatever happens.
 */
export async function handleCallback(rt: AuthRuntime, input: CallbackInput): Promise<CallbackResult> {
  const flow = verifyFlow(rt.jar.readFlow(), rt.config.flowSecret, Math.floor(rt.now() / 1000));
  rt.jar.clearFlow();

  // `endsSession` is false before any code exchange: nothing new exists to tear down, and a forged callback URL must not be able to
  // sign out a learner who is already signed in (logout CSRF).
  const refuse = async (outcome: CallbackOutcome, redirect: string, userId?: string, endsSession = true): Promise<CallbackResult> => {
    if (endsSession) await endSession(rt);
    // Give the seat back at once, so cancelling at Google does not lock a one-seat invitation for the rest of its hold. Releasing only
    // affects a grant that is still 'reserved', so after a successful redemption (or any other state) it changes nothing.
    if (flow?.grant) await releaseQuietly(rt, flow.grant);
    if (userId) await cleanupIdentity(rt, userId);
    rt.log("callback", { outcome });
    return { redirect, outcome };
  };

  if (input.providerError) return refuse("cancelled", errorPage("cancelled"), undefined, false);
  if (!flow || !input.flowParam || !safeEqual(flow.nonce, input.flowParam)) return refuse("state", errorPage("state"), undefined, false);
  if (!input.code || input.code.length > 2048) return refuse("exchange", errorPage("exchange"), undefined, false);

  try {
    const exchanged = await rt.auth.exchangeCodeForSession(input.code);
    if (!exchanged.ok) return refuse("exchange", errorPage("exchange"), undefined, false);
    const user = await rt.auth.getUser();
    if (!user) return refuse("exchange", errorPage("exchange"));

    const verdict = checkGoogleIdentity(user);
    if (!verdict.ok) {
      const reason: AuthErrorReason = verdict.reason === "unverified" ? "unverified" : "identity";
      return refuse(reason, errorPage(reason), user.id);
    }

    const profile = await rt.db.profileState(user.id);

    // Confirming it is you before something irreversible. Only the learner who asked can complete it: a different Google account (or one
    // with no profile) gets nothing, the session it just created is ended, and any profile-less identity is cleaned up as usual.
    if (flow.intent === "reauth") {
      if (profile !== "active" || !flow.uid || !safeEqual(flow.uid, user.id)) return refuse("identity", errorPage("reauth"), user.id);
      rt.jar.setScope(user.id);
      rt.log("callback", { outcome: "reauthenticated" });
      return { redirect: "/account/delete", outcome: "reauthenticated" };
    }

    if (profile === "suspended") {
      return refuse("suspended", errorPage("suspended")); // no cleanup: this is a real account
    }
    if (profile === "active") {
      if (flow.grant) await releaseQuietly(rt, flow.grant); // a returning learner used a join flow: give the seat back
      rt.jar.setScope(user.id);
      rt.log("callback", { outcome: "signed_in" });
      return { redirect: "/account", outcome: "signed_in" };
    }

    // No profile yet.
    if (flow.intent === "join" && flow.grant && flow.adultAt) {
      const result = await rt.db.redeem({
        grantId: flow.grant,
        userId: user.id,
        displayName: displayNameFrom(user),
        adultConfirmedAt: flow.adultAt,
        noticeVersion: PRIVACY_NOTICE_VERSION,
      });
      if (result === "ok" || result === "already_registered") {
        rt.jar.setScope(user.id);
        rt.log("callback", { outcome: "joined" });
        return { redirect: "/account?welcome=1", outcome: "joined" };
      }
      return refuse("invite_unusable", `/join?e=${result === "expired" ? "expired" : result === "revoked" ? "revoked" : "invite"}`, user.id);
    }
    return refuse("no_account", "/auth/no-account", user.id);
  } catch {
    // Database or Auth trouble. Fail closed: no session, and the identity (if any) has no profile, so it has no access.
    // The reservation, if any, is left to expire by itself, so the learner can simply try again.
    return refuse("server", errorPage("server"));
  }
}

async function endSession(rt: AuthRuntime): Promise<void> {
  try {
    await rt.auth.signOut();
  } catch {
    // fall through: the cookies are cleared below whatever the Auth server said
  }
  rt.jar.clearAuthCookies();
}

/** Best effort, and safe by construction: the database function refuses to delete anyone who has a profile or is an admin. */
async function cleanupIdentity(rt: AuthRuntime, userId: string): Promise<void> {
  try {
    await rt.db.purgeOrphan(userId);
  } catch {
    rt.log("cleanup_failed"); // the nightly sweep retries; meanwhile the identity has no access
  }
}

async function releaseQuietly(rt: AuthRuntime, grant: string): Promise<void> {
  try {
    await rt.db.release(grant);
  } catch {
    // the hold expires by itself
  }
}
