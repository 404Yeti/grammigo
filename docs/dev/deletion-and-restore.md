# Account deletion, the deletion ledger, and restoring a backup

## What "delete my account" does

`POST /api/account/delete` (`src/lib/auth/lifecycle.ts`, `handleDelete`). In order, and each step must pass before the next:

1. An **active learner** is signed in (verified with the Auth server). The owner is refused (409): the owner is removed deliberately, by hand.
2. The request is **same-origin** (CSRF) and ≤ 1 KB.
3. **Rate limit**: 5 attempts per 10 minutes per learner + address. Wrong guesses count. Fails closed.
4. The body is exactly `{ "confirm": "delete my account" }` (case and spacing forgiven). It can never name an account.
5. **Recent sign-in**: the session's own authentication time (`amr`) must be ≤ 10 minutes old (the environment may only shorten this, via `AUTH_REAUTH_WINDOW_SECONDS`). Otherwise 403 `reauth_required`, and the screen offers *Sign in with Google again*, a new Google sign-in tied to this learner (`/api/auth/reauth`; the callback accepts only the same account). The exact guarantee, and what it does not guarantee (it does not promise Google re-checked a password), is `security-review.md` §7a.
6. **One database function** (`delete_learner`, one transaction): writes the ledger entry (keyed hash of the id), writes an audit row with no actor, deletes the Auth user. The cascade removes profile, consents, documents, revisions, sessions, refresh tokens and the Google identity. Invitation reservations and audit rows keep their counts but lose the link to the person.
7. The browser's session cookies are cleared; the screen optionally removes this account's saved progress from the device (the guest's progress and other accounts' are never touched).

Failures before step 6 change nothing. A database error at step 6 changes nothing (one transaction) and the learner is told it did **not** happen. Deleting twice at once is harmless (tested).

Verified in `supabase/tests/auth/lifecycle.test.ts` (real local stack): every table, `auth.sessions`, `auth.refresh_tokens` and `auth.identities` have zero rows for the person; the old cookies, a second device and the refresh token are all dead; a bystander is untouched.

## What survives deletion for a while: sessions, refresh tokens and already-issued access tokens

* **Refresh tokens and sessions** are rows owned by the Auth user; deleting the user removes them in the same transaction. A refresh token can never be used again (tested: the refresh attempt fails).
* **The application** verifies every request with the Auth server (`getUser`), not by trusting the cookie's contents, so a deleted user's cookies are rejected on the very next request, on every device (tested through the real handlers and in a browser with a second device).
* **An access token already issued** is a signed token that remains cryptographically valid until it expires: the Auth server's default is **one hour** (`jwt_expiry` 3600 s; the production project's value is to be confirmed in Phase 7 and kept at or below that). Nothing can recall it. What it can still do after deletion: nothing useful. The Auth server refuses it (the user no longer exists), and every table policy requires an active profile for that user id, which no longer exists, so database reads with it return no rows (tested directly against the REST API with the old token). It could in principle be presented to a service that trusts the signature alone without a lookup; Grammigo has none, and any future one must verify with the Auth server or `getUser`.
* **Cookies in the browser** that deleted the account are cleared; the cookies in other browsers are dead for the reasons above even if they linger.

## The deletion ledger

`deletion_ledger(user_hash, deleted_at)`: `user_hash = HMAC-SHA256(INVITE_CODE_PEPPER, "gm-deleted-v1:" + id)`. No id, no email, no name. Immutable (a trigger refuses updates, and refuses deletes for 35 days). The key never lives in the database, so a copy of the ledger alone cannot be turned back into ids, and a hash cannot be used to find anyone without the key.

**The pepper must therefore be kept and must not be rotated casually.** If it is rotated, ledger entries written under the old key stop matching; either replay with the old key first, or wait out the 35 days.

## Why a ledger: restoring a backup brings deleted people back

A restore returns the database to an earlier moment. Anyone who deleted their account since then reappears, which would break the promise made to them. The ledger records those deletions, but **it lives in the same database, so a restore rolls it back too**. The procedure below therefore **saves the ledger before restoring and puts it back**.

### Runbook (use on a disposable project first; any hosted run needs the owner's explicit approval)

1. **Before restoring**, on the live database, export the ledger: `\copy (select encode(user_hash,'hex'), deleted_at from public.deletion_ledger) to 'ledger.csv' csv`. Keep the file safe. It holds hashes only.
2. **Stop sign-in** (keep `NEXT_PUBLIC_ACCOUNTS` off, or the site in maintenance) so nobody uses restored data before step 5.
3. **Restore** the backup into the target database.
4. **Put the ledger back**: `insert into public.deletion_ledger (user_hash, deleted_at) select decode(h,'hex'), t from (…ledger.csv…) on conflict do nothing` (entries older than 35 days can be omitted).
5. **Dry run, then apply the replay** with the same `INVITE_CODE_PEPPER` the app uses:
   ```
   SUPABASE_DB_URL=… INVITE_CODE_PEPPER=… node scripts/replay-deletions.mjs            # counts only
   SUPABASE_DB_URL=… INVITE_CODE_PEPPER=… node scripts/replay-deletions.mjs --apply    # deletes
   ```
   It prints counts, never ids. A warning about "ledger has entries but none matched" means the key is wrong (or nobody needs deleting): check before continuing. It is idempotent. It never deletes an owner.
6. Run the isolation checks (`npm run test:db` against a scratch copy, or the manual checks in `docs/dev/deployment.md`), then **re-enable sign-in**.
7. Record what was done (counts only) in the incident notes.

### What has and has not been rehearsed

* **Rehearsed (automated, in CI, on a disposable local database):** a person is snapshotted, deletes their account, the snapshot is restored over the database (their account, profile, consents and documents come back), the replay removes exactly them and nobody else, a second run does nothing, a wrong key deletes nobody, an owner is never deleted, and the replay functions are unreachable by any client role. The hashing in `scripts/replay-deletions.mjs` is tested to equal the application's.
* **NOT rehearsed:** a real `pg_dump`/provider backup restore, and the provider's point-in-time restore. The simulation is a logical snapshot/restore of the person's rows; it proves the replay logic, not the provider's restore tooling. **Before the first student:** do a full restore drill on a scratch Supabase project (Phase 7, with owner approval) and record the result. Also confirm the provider's backup retention and state it in the privacy notice.

## Export

`POST /api/account/export` returns one JSON file: profile, email, consents, and the current saved documents, read **through the learner's own session** so row-level security returns only their rows (tested with two learners' data side by side). It does not include earlier revisions, anything only on a device, non-personal counters, or the Google account itself; the file says so. It records that an export happened (no content). Limit: 5 per hour. **How it is protected:** the file is built in memory for that one request and returned straight to the browser, which saves it from a temporary in-page file that is released after ten seconds; the server keeps no copy; the response is `Cache-Control: private, no-store`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`; the request is POST, same-origin only, and needs a signed-in active learner; nothing in it is logged (the log line is the fixed word `ok`); there is no link to share. What the learner does with the downloaded file afterwards is theirs. Hosting-platform request logs record the URL and status, not bodies. Suspended learners use `suspended-requests.md`.
