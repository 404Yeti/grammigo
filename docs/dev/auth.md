# Accounts: Google sign-in and invitations (v0.4 Phase 3)

Status: implemented and tested locally and in CI. **Not provisioned and not deployed.** There is no production Supabase project, no
production Google OAuth client, and no DNS change. With `NEXT_PUBLIC_ACCOUNTS` unset (the default) Grammigo is exactly the anonymous,
on-device app and every account page and endpoint answers 404.

Phase 4 (profiles, dashboard, owner invitation management) is described in the last section, and Phase 5 (saving progress, importing guest progress) in `docs/dev/sync.md`. Out of scope until separately approved: **account recovery** (needs its own identity-verification threat model), learner profile
editing and dashboard (Phase 4), cloud sync and progress import (Phase 5), export/delete UI and privacy notice sign-off (Phase 6).

## Architecture in one page

```
Browser ──(plain HTML forms, no Supabase keys, no script needed)──► Next.js route handlers (server)
                                                                         │
        anon key + the person's session cookie ──► Supabase Auth + PostgREST   (row-level security applies)
        service role key (server only)         ──► narrow database functions   (invitations, cleanup, rate limits)
```

* The **browser never talks to Supabase.** There is no `NEXT_PUBLIC_` Supabase variable. Sessions live in `httpOnly` cookies written by
  the server (`@supabase/ssr`), so page script cannot read a token.
* Two kinds of Supabase client, in `src/lib/auth/supabase.ts` (`server-only`):
  * **session client**: anon key + the person's cookies. Row-level security applies to everything it does.
  * **service client**: the service role. Used in exactly two places (`runtime.ts`, the cleanup route); a test enforces that.
* **Every privileged operation is one named, transactional database function** (`reserve_invitation`, `redeem_invitation`,
  `release_reservation`, `purge_orphan_identity`, `create_invitation`, `rate_limit_hit`, …). They are granted to `service_role` only;
  the Phase 2 catalogue test fails if any is reachable by `anon` or `authenticated`.
* `src/proxy.ts` runs **only** on `/account`, `/api/account`, `/api/admin`. It refreshes a session near expiry (Server Components cannot
  write cookies) and redirects a visitor with no session cookie. It is not the authorisation layer; every private page and endpoint
  verifies the session itself, and row-level security checks again.
* The learning code (lessons, mastery, diagnostic, Guided Correction, storage) imports nothing from accounts. A test fails if it does.

### The learner gate

A Google sign-in creates an `auth.users` row for **anyone** who completes OAuth. That row is an *intermediate identity* with **no
profile**. Everything private is gated on an active profile:

| Layer | Rule |
|---|---|
| Database | `is_active_learner()` is false without an active `profiles` row; every learner policy requires it; functions are not executable by `authenticated` |
| App | `getViewer()` verifies the session with the Auth server, then reads the profile **as the user** (so RLS must agree). Result: `anonymous` / `no_profile` / `learner` |
| API | `401` no session, `403` session without an active profile (an uninvited identity and a suspended account are indistinguishable) |
| Pages | `/account` redirects `anonymous` to sign-in and `no_profile` to "No account yet"; nothing private renders first |

## Invitation flow (new learner)

1. `/join`: invitation code + "I am 18 or older" → `POST /api/auth/join` (plain form).
2. Server: same-origin check → rate limits → 18+ check → normalise the code → `reserve_invitation(HMAC(code))`, which locks the invitation
   row and returns an opaque **grant id** (30 minute hold) or `invalid | expired | revoked | full`.
3. Server builds the Google authorize URL with **PKCE (S256)**, checks it is *our* project, *google*, has a challenge and returns to *our*
   callback, then sets the signed **flow cookie** and 303-redirects to Google. If anything is off, the seat is released and nothing is sent.
4. Google → `GET /api/auth/callback?code=…&flow=<nonce>`.
5. `handleCallback` (`src/lib/auth/callback.ts`), in order:
   1. flow cookie verifies (HMAC, expiry, shape) **and** its nonce equals the URL's; the cookie is cleared (single use);
   2. the code is exchanged (Supabase checks the PKCE verifier and its own `state`);
   3. the user is re-fetched from the Auth server and must be a **Google-only** identity with a **verified** email;
   4. active profile → signed in (a returning learner); suspended → refused (never deleted);
   5. no profile + valid grant in this very flow → `redeem_invitation` creates the profile and the two consent rows in **one transaction**;
   6. anything else → sign out, clear cookies, delete the profile-less identity (`purge_orphan_identity`), release the seat.

Returning learners use `/signin` → `POST /api/auth/signin`: same flow with `intent: signin`, no invitation accepted.

### Invitation lifecycle

| Event | What happens |
|---|---|
| Create | Owner API or `scripts/admin-cli.mjs invite`. 1–100 seats, expiry ≤ 90 days. Code shown **once**; only an HMAC (server pepper) is stored. |
| Reserve | Locks the invitation row. Counts `reserved_count` against `max_uses`: 25 parallel tries on a 1-seat code give exactly 1. |
| Redeem | Atomic with profile + consents. Idempotent for the same person; a second person with the same grant is refused. |
| Abandon / cancel | Cancelling at Google, a failed sign-in, or a refused identity releases the seat at once; a forgotten hold expires after 30 min and the nightly job returns the seat. |
| Expire | Checked at reserve **and** at redeem (an invitation can expire while the person is at Google). |
| Revoke | Cancels pending reservations; people who already joined keep working. Owner only. |

## Security properties, and the test that proves each

| Property | Where it is enforced | Test |
|---|---|---|
| Uninvited Google identity reaches nothing private | RLS + `getViewer` + 403 | `flows.test.ts` "unknown Google accounts"; `session.spec.ts` "uninvited Google identity" |
| OAuth state / login CSRF | signed flow cookie + URL nonce, checked before the exchange; PKCE verifier cookie | `callback.test.ts` "state…"; `callback.spec.ts` |
| PKCE is used and verified | authorize URL checked (`S256`); Auth server rejects an exchange without the verifier | `handlers.test.ts` "authorize URL"; `callback.spec.ts` "code Google never issued" |
| Forged grant | HMAC-signed cookie (`gm-flow-v1.` domain-separated) | `core.test.ts` "flow cookie"; `flows.test.ts` "FORGED grant" |
| Replayed grant | DB: a grant redeems once, for one user | `flows.test.ts` "REPLAYED grant", "ten people replaying" |
| Seat limits under concurrency | `FOR UPDATE` on the invitation row | `flows.test.ts` "15 simultaneous joins on a 4-seat invitation"; Phase 2 invitation tests |
| Unverified email never joins | `checkGoogleIdentity` | `core.test.ts`; `flows.test.ts` "UNVERIFIED" |
| No automatic linking by email | Google-only check; profiles have no email column; GoTrue unique email | `core.test.ts` "LINKED"; `flows.test.ts` "no automatic account linking" |
| Brute force of codes | ~54 bits of entropy; per-address and global DB rate limits; fail closed | `flows.test.ts` "rate limiter"; `join.spec.ts` "9th guess" |
| Cleanup failure is harmless | identity without profile has no access; sweep retries | `callback.test.ts` "security holds…"; `flows.test.ts` "deletion FAILS" |
| Cleanup never deletes a real account | SQL guard: no profile and not admin, in one statement | `flows.test.ts` "purge_orphan_identity never deletes…" |
| Logout CSRF / cross-site POST | `Origin` / `Sec-Fetch-Site` check; no sign-out on failed callback | `handlers.test.ts`; `session.spec.ts` "no logout CSRF" |
| Open redirect | `safeNext` allowlist; redirects built from the configured site URL | `core.test.ts` "safe redirect" |
| Session revoked / expired / tampered | server-verified `getUser`; proxy refresh | `flows.test.ts` "sessions"; `session.spec.ts` "expiry and revocation" |
| Cross-account isolation | RLS | `flows.test.ts`; `session.spec.ts` "cross-account isolation" |
| Private pages never cached | `Cache-Control: private, no-store`, framing and sniffing headers | `session.spec.ts` "never cacheable" |
| Service role never reaches the browser | `server-only`; architecture tests | `boundaries.test.ts` |
| Secrets never logged | structured, content-free events | `callback.test.ts` "logs only the outcome" |

## Cookies, redirects and caching

* Cookies: `httpOnly`, `SameSite=Lax` (it must survive the redirect back from Google, and no weaker), `Path=/`, **`Secure` on https**,
  no `Domain`, and the **`__Host-` prefix on https** so a sibling subdomain cannot overwrite them. Session cookies live at most 7 days and
  are rewritten on refresh. The flow cookie lives 30 minutes and is single use.
* Redirects: the OAuth `redirect_to` and every post-sign-in redirect are built from `AUTH_SITE_URL`, never from the `Host` header. The only
  `next` honoured is an in-site path on an allowlist.
* Caching: `/account`, `/auth/*`, `/api/auth/*`, `/api/account/*`, `/api/admin/*` send `Cache-Control: private, no-store, max-age=0`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`. `/join` and
  `/signin` are public but cannot be framed. The public learning pages are deliberately untouched.
* Every account route calls `connection()` first so it is decided **per request**; a route that answered before reading the request would be
  prerendered at build time and bake in its early answer.

## Configuration

Server-only environment variables (see `.env.example`): `NEXT_PUBLIC_ACCOUNTS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE_PEPPER`, `AUTH_FLOW_SECRET`, `AUTH_SITE_URL`, `CRON_SECRET`. Off: 404. On but incomplete or weak: 503.

### Supabase project settings to apply at provisioning (Phase 7, after approval)

* Providers: **Google on; Email off**; phone and every other provider off; anonymous sign-ins off.
* Sign-ups: leave **allowed** (Google creates an identity for anyone; the app, not Supabase, decides who becomes a learner).
* **Manual identity linking off.** Automatic linking is moot with a single provider; the Google-only check guards a mistake.
* Redirect URLs: only `https://<site>/api/auth/callback**` (the flow nonce is in the query string).
* Site URL = the same origin as `AUTH_SITE_URL`.
* Sessions (Pro plan): time-box and inactivity timeout. Suggested starting point: time-box 30 days, inactivity 7 days.
* Region `ap-southeast-1` (Singapore), Pro plan, daily backups.
* Scheduler: call `GET /api/auth/cleanup` daily with `Authorization: Bearer $CRON_SECRET` (Vercel Cron: add `vercel.json` `crons` **at
  enablement time**, not before; the route is 404 while accounts are off).

### Owner bootstrap

1. Make a first invitation: `node scripts/admin-cli.mjs invite --label Owner --seats 1 --days 7` (service role + pepper, on your machine).
2. Join with it. 3. `node scripts/admin-cli.mjs grant-admin --user <your auth user id>`. After that use `/api/admin/invitations`
   (create / list / revoke); owner screens are FAI-42.

## Known limits (see the PR for the full risk list)

* The real Google consent screen and Supabase's exchange have never run here: they cannot run locally. They are first exercised in the
  Phase 7 preview. Everything around them is tested; the exchange is the one stubbed call in the integration tests.
* Rate limits key on the client address. On Vercel the platform header is trustworthy; elsewhere it is weaker.
* Access tokens stay valid for up to their lifetime (1 hour) after sign-out for direct data-API calls, because a JWT is self-contained;
  row-level security still limits what they can reach, and the app's own pages verify sessions with the Auth server every time.

## Phase 4: profiles, dashboard and owner invitation management

Screens (Figma page 16): D1/D2 dashboard at `/account`, E1 profile at `/account/profile`, E2 edit at `/account/profile/edit`, F1–F4 owner
invitations at `/account/invitations`. All are 404 while accounts are off, and all use existing components and design tokens (`AppShell`, `Card`,
`GrammarTag`, `StatTile`, `ProfileSummary`, `TextField`, `Button`).

### What each screen shows, and where the data comes from

| Screen | Data | Source |
|---|---|---|
| Dashboard: next step, skills so far, strengths, weaknesses, caveat | the app's own `deriveLearning` (mastery, profile, recommendations are derived, never stored) | **this device's** saved history |
| Dashboard: quick check | the real saved diagnostic runs (when, how many answers, how many skills it gave evidence on) | this device |
| Dashboard: continue where you left off | the active lesson session | this device |
| Dashboard: what you're practising | `profiles.preferences.practising` | the account (RLS, the learner's own session) |
| Dashboard: Fix it with Migo | counts of how exercises ended | the guided store on this device; provisional |
| Profile / edit | display name, first language, topics, daily time, email, member since | the account (RLS, the learner's own session) |
| Invitations | label, last four characters of the code, seats used, expiry, status | the owner API |

**Progress is on this device, and the dashboard says so** ("Progress on this device"; "Your lessons and progress are saved in this browser, not in your
account yet"). Cloud sync and importing an anonymous device's progress are Phase 5, so the Figma chip "Saved to your account" is deliberately not used.

### Deliberate deviations from the Figma designs

1. **Dashboard chip** says "Progress on this device", not "Saved to your account" (sync is Phase 5; the original wording would be untrue).
2. **Owner list shows `Code ending ABCD`, not `GRAM-7K2Q9-•••••`.** Five visible characters would cut a code's ~2^54 search space to ~2^29, and a "Copy link" on a
   listed invitation is impossible because only a keyed hash is stored. Copying is offered once, right after creation (F3).
3. **The shareable link is `/join#c=CODE` (a URL fragment), not `/join/CODE` (a path).** Fragments are never sent to a server, so the code stays out of access logs
   and `Referer` headers; the page fills the box and removes the fragment from the address bar immediately.
4. **No "AI helpers" preference row.** No such setting exists in the app, and a switch that changes nothing would be misleading.
5. **Practising topics come from the real curriculum topics**, not the sample chips in the mock.
6. **Owner "Expire now"** is added next to Revoke (the requirement lists both; the designs show only Revoke).
7. **A sign-in entry point on the existing home screen / header avatar is not added in this phase.** It needs to know whether someone is signed in, and the learning code deliberately
   does not know accounts exist (tested). It belongs with Phase 5/7 integration, when the anonymous and signed-in experiences are joined.

### Security properties added, and their tests

| Property | Enforced by | Tests |
|---|---|---|
| A learner reads and writes only their own profile; the id comes from the verified session, never the request | `profile-api.ts` + RLS + column grants (name, language, time zone, preferences only) | `profile-api.test.ts`; `profile-owner.test.ts` "unauthorized profile edits"; `phase4.spec.ts` |
| No privileged credential on any learner read or write | the profile API takes only the learner's session client | `boundaries.test.ts` "learner data never goes through privileged credentials"; "forged viewer" integration test shows RLS refuses even then |
| Privileged and identity fields cannot be sent at all | strict schema (`id`, `status`, `adult_confirmed_at`, `isAdmin`… are rejected) | `accounts.test.ts`; integration; browser |
| Owner operations: create, list, revoke, expire | one gate: verified session + active learner + `app_admins` + same-origin + rate limit | `profile-owner.test.ts`; `boundaries.test.ts` |
| Owner pages are invisible to everyone else | `requireLearner({ admin: true })` → plain 404 | `phase4.spec.ts` |
| The full invitation secret is shown once; never stored, listed, logged or put in the URL | HMAC-only storage; explicit list columns; the screen touches no storage or console | `InvitationManager.test.tsx`; `boundaries.test.ts`; `phase4.spec.ts` (storage, cookies, responses, reload, audit log) |
| Every owner action is audited with the owner as actor; no code in the audit log | `create_invitation`, `revoke_invitation`, `expire_invitation` (migration `20261102000100`) | `profile-owner.test.ts`; `phase4.spec.ts` |
| Private pages and APIs are never cached or framed | `Cache-Control: private, no-store` + `X-Frame-Options` + `frame-ancestors 'none'` on `/account/**` and the account/admin APIs | `phase4.spec.ts` "private pages are never cached" |
| Guided Correction is never mastery or proficiency | counts only, on the guided side, labelled Beta and provisional; mastery is byte-identical with and without guided activity | `Dashboard.test.tsx`; `claims.test.ts`; `separation.test.ts` |

### Expire vs revoke

* **Expire now**: the invitation stops accepting NEW sign-ins immediately. Someone who already holds a reservation (partway through Google sign-in) can finish. Nothing about
  people who already joined changes.
* **Revoke**: the hard stop. It also cancels pending reservations; people who already joined keep their accounts.


## Phase 6: export, deletion and confirming it is you

* `POST /api/account/export`: the learner's own records as a JSON download (their session, row-level security; audited as a fact).
* `POST /api/auth/reauth`: a signed-in learner signs in with Google again. The flow cookie has `intent: "reauth"` and the learner's id; the callback accepts only that account and returns to `/account/delete`. It can never create an account.
* `POST /api/account/delete`: typed words + sign-in no older than `reauthWindowSeconds` (default and maximum 600; `AUTH_REAUTH_WINDOW_SECONDS` can only shorten it) + same origin + rate limit, then one database function. See `deletion-and-restore.md`.
* Pages: `/account/data`, `/account/delete`, `/auth/deleted`. Account recovery is still out of scope.
* Review notes: `security-review.md`. Legal: `docs/legal/`. Real iPhone checklist: `real-device-acceptance.md`.
