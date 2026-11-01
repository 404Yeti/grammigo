# Phase 6 security review: accounts, sign-in, deletion, export

Scope: OAuth callback, cookies, CSRF, rate limits, logging, service-role boundaries, and the new export / deletion / re-sign-in paths. Method: reading the code, plus tests that fail if a property stops being true (named below). **This is an internal review by the developer of the code, not an independent audit or penetration test.** An independent review should happen before real students (see "Residual risks"). Nothing here has run against real Google or the production Supabase project.

## 1. OAuth callback (`lib/auth/{start,flow,callback}.ts`)

| Property | How it holds | Evidence |
|---|---|---|
| Login CSRF / callback replay | A signed, httpOnly, 30-minute **flow cookie** carries a nonce that must equal the nonce in the callback URL; checked in constant time before anything is exchanged. A link opened in another browser has no matching cookie. | `callback.test.ts`, `e2e-accounts/callback.spec.ts` |
| Forged / expired flow | HMAC-SHA256 under a server secret (`AUTH_FLOW_SECRET`, ≥ 32 chars, must differ from the pepper); strict schema; expiry; size cap; domain-separated MAC. | `core.test.ts`, `reauth.test.ts` |
| Single use | The flow cookie is cleared at the start of every callback, whatever happens. | `callback.test.ts` |
| PKCE and provider state | Supabase's PKCE verifier cookie and state are checked in the code exchange; `startGoogle` refuses to send the browser anywhere unless the authorize URL is *our* Supabase project, Google, S256 PKCE, and returns to *our* callback with *our* nonce. | `handlers.test.ts` (`isExpectedAuthorizeUrl`) |
| Logout CSRF | Before a code is exchanged nothing is torn down, so a forged callback cannot sign out a signed-in learner. | `callback.test.ts` |
| Open redirect | Every redirect target is a fixed constant or built against the configured site URL, never the `Host` header or a request value. Error pages echo nothing from the URL. | `callback.spec.ts`, `safe-redirect` tests |
| Identity | Google-only, verified email, no account linking, no auto-linking by email; a profile-less identity is purged (and a failed purge still leaves it powerless: no profile, no access; nightly sweep retries). | `core.test.ts`, `flows.test.ts` |
| Rate limit | 30 callbacks / 10 min / address, before the exchange; fails closed. | `handlers.test.ts` |
| **New: re-sign-in** | Intent `reauth` is bound to the learner's id in the signed flow; the callback accepts only that same account with an active profile; a different account (or one with no profile) is refused, its session ended and identity purged; it can never create an account or touch an invitation. | `reauth.test.ts` (11 cases) |

## 2. Cookies

* Session `gm-auth`: httpOnly, SameSite=Lax, Path=/, no Domain, `Secure` + `__Host-` prefix over https, ≤ 7 days (`hardenCookie`). Flow cookie same attributes, 30 minutes. Scope cookie `gm-scope` holds only the account id (a *folder selector*, grants nothing) and is deliberately script-readable.
* Private pages and APIs send `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`; a Back press after sign-out shows nothing (`phase4.spec.ts`, `phase6.spec.ts`).
* Deleting an account clears the session, flow and scope cookies (`clearAuthCookies`).

## 3. CSRF

Every state-changing route (join, sign-in, sign-out, **re-sign-in, export, delete**, profile, sync, consent, admin) requires `Origin` equal to the configured site, or, if absent, `Sec-Fetch-Site: same-origin` (`isTrustedOrigin`), on top of SameSite=Lax. Export is a POST precisely so it needs this. GET routes are read-only except the OAuth callback (protected by the flow nonce) and the cron cleanup (bearer secret). Tests: each route's cross-site request returns 403 (`join.spec.ts`, `phase4.spec.ts`, `phase6.spec.ts`, `lifecycle.test.ts`).

## 4. Rate limits (durable, in Postgres; keys are HMACs of endpoint + address/user; fail closed)

join 8/10 min and 60/day per address, 600/h global · sign-in 20/10 min · callback 30/10 min · **re-sign-in 10/10 min** · admin 30/min · profile 20/min · sync 60/min · consent 10/min · **export 5/hour/learner** · **delete 5/10 min/learner** (wrong confirmations count). Exercised against the real limiter in `lifecycle.test.ts`.

## 5. Logging

Only `log(event, { outcome: … })` with fixed words is allowed in `lib/auth` (architecture tests forbid `console.*` there and require the lifecycle log fields to be a single fixed `outcome`). No id, email, name, code, token or address is logged. Audit rows hold kinds and counts only; the actor link is cleared at deletion. Not under our control: Vercel's own request logs (IP, path, user agent) and Supabase's service logs.

## 6. Service-role boundaries

The service role bypasses row-level security. It is created only in `lib/auth/supabase.ts`, used by exactly these callers, and a test fails if the list changes:

| Caller | Privileged operations |
|---|---|
| `lib/auth/db.ts` (via the runtime) | reserve / redeem / release invitation, profile-state lookup, purge profile-less identity, rate-limit counter |
| `lib/auth/sync-api.ts` | `put_document`, `record_consent` (nothing else; reads go through the learner's own client) |
| `lib/auth/lifecycle.ts` | **`audit_export`, `delete_learner`** (nothing else; export reads use the learner's client) |
| `lib/auth/admin.ts` | owner invitation operations, behind the owner gate |
| `app/api/auth/cleanup` | nightly sweep, behind the cron secret |
| operator script `scripts/replay-deletions.mjs` | `all_user_ids`, `ledger_hashes`, `redelete_learner` (database URL supplied by the operator; not reachable from any route: tested) |

The learner's identity always comes from the verified session, never from a request field (tested for sync, profile, export and delete). Server functions are granted to `service_role` only (`catalogue.test.ts`, `isolation.test.ts`, `rest.test.ts` check every function against anon, learners, owner and an uninvited identity).

## 7. Findings from this review

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Deleting an account needs more than a cookie: before this phase there was no deletion at all. Now: typed words + sign-in no older than 10 min (from the session's own `amr` time, **not** the token's `iat`, which moves on every refresh) + origin + rate limit. | design | done, tested |
| 2 | The owner could be deleted through self-service, locking everyone out of invitations. | medium | fixed: refused by handler (409) **and** by the database function |
| 3 | The deletion ledger could not be replayed (no key-based matching, no operator tool). | medium | fixed: keyed hash, three server-only functions, tested script |
| 4 | A restore rolls the ledger back with the data. | medium | documented procedure saves and re-applies the ledger first (`deletion-and-restore.md`); needs a full drill on a scratch project |
| 5 | Re-sign-in mismatch (a different Google account completes the flow) replaces the session before the callback can refuse it. | low | accepted: the new session is ended and cleared, i.e. the learner is signed out (fail closed); tested |
| 6 | Suspended learners cannot self-serve export or deletion (row-level security requires an active profile). | low | fixed by a documented, tested owner-assisted process that never restores access (`suspended-requests.md`); counsel to approve its identity check |
| 7 | Rate limits key on the client address; off Vercel `x-forwarded-for` can be spoofed, weakening per-address limits. | low | accepted; per-learner limits (export, delete) are unaffected; per-address ones are fine on Vercel |

## 7a. The precise guarantee behind "sign in again" (read this before relying on it)

Deleting an account requires that the session's **most recent authentication event is no more than 10 minutes old**. The time is the `amr` timestamp in the session token, which Supabase sets when it completes a sign-in (the OAuth code exchange). It is not the token's issue time, which moves on every refresh.

**What this guarantees:**
1. The Auth server verified the session just now (it is a real, unrevoked session of an active learner).
2. Within the last 10 minutes someone completed a Google sign-in that ended at our callback with a valid flow cookie, nonce and PKCE exchange. A normal sign-in in the last 10 minutes therefore also counts; no second sign-in is asked for.
3. When the learner presses *Sign in with Google again*, the flow is started from their own session, is tied to their account id in a signed cookie, and is accepted only if the **same** Google account (with an active profile) comes back. Any other account is refused and its session ended.
4. The person also typed the confirmation words.

**What this does NOT guarantee, and we do not claim:**
* That Google asked for the account's **password** or a second factor. We request `prompt=select_account`, which forces the account chooser; whether Google also re-checks credentials depends on Google's own session state and policy.
* That the person at the keyboard is the account's owner. Someone with an unlocked, signed-in browser on the same device can finish the flow.
* Anything about Google's side of the authentication: we only learn that the code exchange succeeded.

So the check defends against a **stolen or leaked session cookie used from elsewhere** and against **accidental or scripted deletion** (it needs a fresh, same-account sign-in, typed words, a same-origin request and is rate limited). It does not defend against a person with live access to the user's unlocked, signed-in device. The wording in the app says "Sign in with Google again" and states that it cannot tell whether Google asked for a password. Verifying how real Google behaves is a provisioning-phase task.

## 8. Residual risks

0. **Suspended-learner requests** (`suspended-requests.md`): the identity-verification method, password-protected delivery and 72-hour deletion delay require legal/security review before production use., not yet verified (all need the owner's approval to test for real)

1. **How strong Google's re-sign-in is** (see 7a): not guaranteed to re-check a password. Behaviour with real Google (and whether `prompt=login` is honoured) must be tested in the provisioning phase and the wording kept honest.
2. **`amr` timestamps on refresh.** Locally verified with password sign-ins; Google OAuth sessions are expected to behave the same but unverified.
3. **Real Google consent and code exchange** have never run (cannot, locally).
4. **Backups / point-in-time restore** of the real provider are untested (see the restore document).
5. **Independent review**: no external security review or penetration test has been done.
6. Account recovery is deliberately absent; a deleted account cannot be recovered.


## 9. Email + password (added with the second sign-in method)

Passwords are stored, hashed and checked **only by Supabase Auth**; Grammigo never stores or logs one and has no password column. Our code sets rules (12+ characters, ≤ 72 bytes, not trivial), rate limits and decides who may have an account.

| Threat | Control | Evidence |
|---|---|---|
| Someone registers without an invitation | Our `/api/auth/email/register` requires a valid code and reserves a seat first. Making an account through the **public Auth API** directly is possible (the anon key is public) but yields a person with **no profile**: `is_active_learner()` is false, so row-level security shows them nothing, they cannot write a profile (no INSERT grant), and our sign-in refuses them (and removes the profile-less account of the person who just signed in with its own password but holds no seat). The nightly sweep deletes any profile-less identity older than 25 hours | `supabase/tests/auth/password.test.ts` (direct sign-up, confirm, sign in, REST reads return nothing, RPC denied, profile insert denied) |
| Invitation redeemed by the wrong address | The seat is bound to a keyed hash of the registering address and is redeemed only by a **confirmed** account with exactly that address | same file ("the seat belongs to the address it was reserved for") |
| Confirmation skipped | The Auth server refuses password sign-in until the link is opened; if the project ever auto-confirmed (a setting error), registration notices a session coming back, ends it, gives the seat back and fails closed; the readiness check fails on `mailer_autoconfirm` | unit + readiness tests |
| Pre-registration ("squatting") of an invited address through the public API | Registration **never deletes or modifies** an existing Auth user because another registration presents the same address: it answers "can't be used", reserves no seat and sends no mail, so nobody can destroy another person's pending registration. A profile-less leftover has no access and is removed only by the sweep once older than 25 hours (longer than the 24-hour seat hold); until then the invited person is told the address can't be used and the owner can run the sweep. Cost: an invitee blocked by a squatter waits for (or asks the owner to run) the sweep | unit test "never deleted or touched" and database test "a squatter … gets nothing" |
| Two sign-in methods silently joined for one person | An address that already has a profile, or any Google identity, cannot register by email; reset emails are sent only to email-only accounts; every sign-in path refuses a user that has more than one identity. (Supabase can attach a second identity on its own when verified addresses match; the application then refuses to operate that account rather than treat it as one person, and the owner resolves it by hand.) | unit + database tests |
| Password guessing | Supabase's own limits plus ours: 20 per 10 minutes per network address and **8 per 10 minutes per address being guessed**, whatever the right password is | database test (ninth guess refused) |
| Account enumeration | Sign-in: one message for wrong password and unknown address; registration reports "can't be used" only to someone holding a valid invitation code; reset: the same page and no email for any non-eligible address | unit tests |
| Reset-link abuse | The emailed link opens our page `/auth/reset?token_hash=…`, which **changes nothing** (a mail scanner or preview that fetches it cannot use the one-time token); the button POSTs the token (origin-checked, rate-limited, shape-checked) and the Auth server verifies it, so it works on **any browser or device**, once, for one hour. Only an email-only account with a profile gets on; a Google account or one without a profile is signed out and refused; a new password ends **every** session on every device. Accepted: the token is in the URL query (visible in Vercel request logs and the mail client; single-use and short-lived) and whoever can read the mailbox can reset the password (true of every email reset). The older same-browser PKCE link (`GET /api/auth/recover?code=`) is kept only as a fallback for a project whose reset email still has the default link | unit + database + browser tests (incl. different browser, scanner fetch, single use) |
| Deleting an account with a stolen cookie | Same 10-minute rule as Google: a password sign-in is the "recent sign-in", and re-confirming must be the same account | database test |

Residual and accepted: a person who holds a valid invitation can register an address that is not theirs (the mailbox owner receives a confirmation email; without confirming it nothing is created; confirming it hands the account to whoever set the password, who already had an invitation); registration and reset send email through the owner's SMTP quota, so abuse is limited by the per-address and per-network limits above and by Supabase's own email limits; the public Auth API can be used to send a limited number of confirmation emails to arbitrary addresses (Supabase rate-limits it; keep the custom SMTP limit low).
