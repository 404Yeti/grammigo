# Production migration plan (Phase 7B; NOT executed; needs explicit approval at each gate)

Target: Supabase project `ugifdvaaaioiqmwfiksw`. Today it is **unverified and assumed empty** (the public endpoint answers; nothing else could be inspected without credentials). Every statement below that depends on its state is a **pre-flight check**, not a fact.

## Principles
1. Nothing runs on production until a scratch project has taken the **identical** sequence and passed the same checks (rehearsal), and the owner approves the run.
2. Migrations are applied by one person, one at a time, from a clean checkout of the approved commit, with `supabase db push --linked` (or the SQL editor pasting the exact files, if the CLI cannot connect). No hand-edited SQL.
3. The service-role key and the database password are used only on the operator's machine for this step, typed into the terminal or taken from a password manager, never written to a file in the repo, a shell history file, a ticket or this chat.
4. After each migration, run its **check query** (below). Stop on the first surprise.

## Pre-flight (read-only; owner runs these, or runs `supabase login` and lets me run them)
| # | Check | How | Must be |
|---|---|---|---|
| 1 | Region, organisation, plan | Dashboard → Project settings; or `npx supabase@2.122.0 projects list` | Region recorded (design assumes `ap-southeast-1`); plan Pro or better (daily backups) |
| 2 | Postgres major version | Dashboard → Infrastructure | ≥ 15 (local stack is 17; the SQL uses nothing newer than 15) |
| 3 | Schema is empty | `select count(*) from pg_tables where schemaname='public';` | 0 (anything else: stop and review) |
| 4 | No extra roles/extensions we do not expect | `select extname from pg_extension;` | Supabase defaults only (`pgcrypto`, `uuid-ossp`, `pg_graphql`, `pg_stat_statements`, `supabase_vault`, `plpgsql`) |
| 5 | Auth users | `select count(*) from auth.users;` | 0 |
| 6 | Auth settings match `auth-checklist` in `google-oauth-and-config.md` | Dashboard → Authentication | All items ticked **before** any sign-in is possible |
| 7 | Backups available | Dashboard → Database → Backups | Daily backups listed (Pro); note retention |
| 8 | API exposure | Dashboard → API settings: exposed schemas | `public` only; `graphql_public` may stay. Confirm the Data API "automatically expose new tables" default does not matter: the migrations revoke default privileges |

## Order (as in `supabase/migrations/`, oldest first; they are cumulative, never re-ordered)
| # | File | What it does | Check after |
|---|---|---|---|
| 1 | `20261101000100_core_schema` | revokes default grants, creates `profiles`, `consents`, `invitations`, reservations, `app_admins`, `audit_events`, `deletion_ledger`, RLS and the learner gate | every table so far (10 after the last step, as listed in `catalogue.test.ts`) has RLS on: `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='public' and relkind='r';` all `true` |
| 2 | `…000200_invitations` | `reserve/redeem/revoke_invitation` | `select proname from pg_proc where pronamespace='public'::regnamespace;` lists them |
| 3 | `…000300_learner_documents` | `learner_documents`, versions, `put_document`, `restore_document_revision`, `valid_document` | tables exist, RLS on |
| 4 | `…000400_deletion_and_cleanup` | `delete_learner`, `orphan_identities` | functions exist |
| 5 | `…000500_auth_support` | rate limits, release, purge, `create_invitation` | `rate_limits` table exists, RLS on |
| 6 | `20261102000100_owner_tools` | `expire_invitation` | exists |
| 7 | `20261103000100_sync_consent` | `record_consent`, consent-gated `put_document` | exists |
| 8 | `20261104000100_lifecycle` | `audit_export`, replay functions, owner-safe `delete_learner`, bounded `rate_limit_hit` | exists |

### The privilege check that must pass after step 8 (this is the safety net)
Run as the **anon key over the REST API** (read-only; no secrets beyond the public anon key) and as SQL:
* `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');` returns only `authenticated` SELECT on `profiles`, `consents`, `learner_documents` and UPDATE on four `profiles` columns (compare with `supabase/tests/sql/catalogue.test.ts`).
* `select routine_name, grantee from information_schema.routine_privileges where routine_schema='public' and grantee in ('anon','authenticated','PUBLIC');` returns only `is_active_learner` and `is_admin` for `authenticated`.
* `curl -H "apikey: $ANON" $URL/rest/v1/profiles` → empty/refused; `…/rpc/delete_learner` → 401/403/404.
The same assertions already run in CI (`catalogue`, `isolation`, `rest`); on production they are repeated by hand because CI cannot reach it.

## Rollback and recovery (read before running anything)
* **Before the first migration:** take a dashboard backup point if the plan allows (Pro: daily backup exists; if the project is brand new there is none: that is fine because the database is empty).
* **While the database is empty (the only supported rollback):** a failed or mistaken migration is rolled back by resetting the `public` schema and the migration history: `drop schema public cascade; create schema public; grant usage on schema public to postgres, anon, authenticated, service_role;` and `delete from supabase_migrations.schema_migrations;` then re-apply from step 1. This **destroys everything in `public`**, so it is allowed **only while no real learner exists**, only with the owner's explicit go-ahead in that moment, and never after the first invited student signs up. (The Auth schema is untouched by it; delete test users through the app.)
* **After real users exist:** there is **no down-migration**. Mistakes are fixed by a new forward migration, reviewed and rehearsed on scratch first. Data recovery is by the provider's backup (see `restore-drill-plan.md`) plus the deletion-ledger replay (`docs/dev/deletion-and-restore.md`). Never restore over production without the owner's explicit approval and a fresh export of the ledger.
* Each migration is a single transaction in `db push`; a failure inside one leaves nothing half-applied. A failure between migrations leaves a consistent earlier state (they are cumulative).
* Migration history must show exactly the 8 versions above. Anything else: stop.

## What stays out of the migrations
Dashboard-only settings (Google provider, redirect URLs, JWT expiry, email provider off, signup rules) are **not** in SQL; they are in the checklist in `google-oauth-and-config.md`. Those are verified by reading `GET /auth/v1/settings` with the anon key (public) and comparing with the expected list (a script in 7B).
