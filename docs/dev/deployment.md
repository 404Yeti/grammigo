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
