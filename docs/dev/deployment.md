# Deployment targets and rules

## Hosted database: PRODUCTION Supabase project

| | |
|---|---|
| Project reference | `ugifdvaaaioiqmwfiksw` |
| URL | `https://ugifdvaaaioiqmwfiksw.supabase.co` |
| Role | Grammigo's permanent **production** database |
| Recorded | 2026-11-01, on the owner's confirmation |

The reference and URL are public identifiers, not secrets. **No key, token or password for this project is, or may ever be, committed.**

### Not yet verified (do in Phase 7, with the owner)

The following have **not** been checked, because no credentials have been supplied and nothing has connected to this project:
organization, region (target is `ap-southeast-1`, Singapore), plan, backups, and whether any schema or migration already exists.
Do not assume any of them. The first Phase 7 step is a read-only inspection that is reported to the owner before anything changes.

### Rules (owner's instructions)

1. **Never** use this project for automated tests, destructive testing, or development experiments. Development and database tests run on the local
   Supabase stack and in CI only (`npm run test:db`, `npm run test:e2e:accounts`).
2. **Do not** apply migrations, configure authentication or the Google OAuth client, add credentials, or connect the production application to it
   until the owner separately authorises each step during the rollout phase (Phase 7).
3. **Any** production database modification needs the owner's explicit approval first, every time. Approval for one change is not approval for the next.
4. Never commit Supabase credentials or the service-role key. Server secrets go in the hosting provider's encrypted environment settings only.

### Phase 7 sequence (each step needs approval)

1. Read-only inspection: organization, region, plan, existing schema. Report.
2. Apply the reviewed migrations in `supabase/migrations/` in order. Re-run the catalogue and isolation checks against the result.
3. Configure authentication per `docs/dev/auth.md` ("Supabase project settings to apply at provisioning").
4. Validate row-level security on the real project with disposable test identities that are deleted afterwards.
5. Walk the whole Google invitation flow on a preview deployment with the owner.
6. Only then set `NEXT_PUBLIC_ACCOUNTS=on` for production and invite students.

### Application state

Accounts are disabled in production (`NEXT_PUBLIC_ACCOUNTS` unset): every account page and endpoint answers 404. Verified on the live
deployment after the Phase 3 merge (`/join`, `/signin`, `/account`, `/api/account/me`, `/api/admin/invitations`, `/api/auth/*` all 404;
anonymous lessons, library, onboarding and the AI status endpoint unchanged, no cookies set).

## Added by Phase 6: what must be done and verified at provisioning (Phase 7), each with the owner's explicit approval

Nothing below has been done. Production Supabase `ugifdvaaaioiqmwfiksw` is untouched, accounts are off, and no real Google OAuth client is configured.

1. Verify the project's organisation, **region** (the design assumes ap-southeast-1) and that the schema is empty. Record the region in the privacy notice.
2. Apply the reviewed migrations (including `20261104000100_lifecycle.sql`) only after approval; validate RLS with the isolation suite against a scratch copy first.
3. Set secrets in the host (never in git): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE_PEPPER` (**also the deletion-ledger key: keep it, do not rotate casually**), `AUTH_FLOW_SECRET`, `AUTH_SITE_URL`, `CRON_SECRET`. Do **not** set `AUTH_REAUTH_WINDOW_SECONDS` (default 10 minutes is the maximum).
4. Real Google OAuth: record what the "sign in again" step actually requires of a person who is already signed in to Google (`security-review.md` §7a) and keep the wording honest.
5. **Restore drill** on a scratch Supabase project: take a backup, delete a test account, restore, run `scripts/replay-deletions.mjs`, confirm the deleted account is gone (`deletion-and-restore.md`). Record the provider's backup retention and put it in the notice.
6. Legal gate (`docs/legal/legal-review-pack.md` §6) and the real-iPhone checklist (`real-device-acceptance.md`) are completed **before** the first student is invited.
