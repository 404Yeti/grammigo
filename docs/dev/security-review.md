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
| 6 | Suspended learners cannot self-serve export or deletion (row-level security requires an active profile). | low | open: manual owner-assisted process to be written (legal pack Q7) |
| 7 | Rate limits key on the client address; off Vercel `x-forwarded-for` can be spoofed, weakening per-address limits. | low | accepted; per-learner limits (export, delete) are unaffected; per-address ones are fine on Vercel |

## 8. Residual risks, not yet verified (all need the owner's approval to test for real)

1. **How strong Google's "confirm it's you" is.** We send `prompt=select_account`, which forces an interactive step, but Google may not ask for the password again if a Google session is active. Our freshness check measures the time of *our* sign-in, not Google's. Behaviour with real Google (and whether `prompt=login` is honoured) must be tested in the provisioning phase, and the wording adjusted if it is weaker than it sounds.
2. **`amr` timestamps on refresh.** Locally verified with password sign-ins; Google OAuth sessions are expected to behave the same but unverified.
3. **Real Google consent and code exchange** have never run (cannot, locally).
4. **Backups / point-in-time restore** of the real provider are untested (see the restore document).
5. **Independent review**: no external security review or penetration test has been done.
6. Account recovery is deliberately absent; a deleted account cannot be recovered.
