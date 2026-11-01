# Production migration runbook (Supabase Free) — NOT EXECUTED; for the owner's authorization

Target: Supabase project **`ugifdvaaaioiqmwfiksw`** (region ap-southeast-1, organisation `grammigo`, Free plan). Facts checked read-only on 2026-11-02: project ACTIVE_HEALTHY; `public` schema empty (0 tables); 0 applied migrations; `auth.users` 0 rows; 5 extensions (`plpgsql`, `pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault`); no branches; the only security findings are the two warnings on `public.rls_auto_enable()`.

## STATE AS OF 2026-11-02 (read this first)
The sequence was started through the connector and **stopped by the connector's own confirmation step**: migrations **1 `core_schema` and 2 `invitations` are applied** (registered by the connector under its own version numbers `20261101102513` and `20261101102527`); the connector then **auto-cancelled** the call for migration 3 twice (0.8 s after sending, with no SQL error), apparently because a call that contains `delete from` needs a human to confirm it and a headless session cannot. Production therefore holds only: the core tables with row-level security, the learner gate, and the three invitation functions. **No data, no users, no profiles.** Migrations **3 to 9 are not applied.** Nothing was worked around.

**To finish, one of these (yours to choose; both need you at a terminal once):**
1. *Interactive connector session:* run `claude` in your own terminal in the repository and ask it to "resume the production migrations 3 to 9 from docs/ops/production-migration-runbook.md"; you will see each confirmation and press yes.
2. *Supabase CLI (no Docker), from the merged commit `025173d` or later on `main`* (so that the not-yet-approved tenth migration is not in the folder):
   ```
   npx supabase@2.122.0 login
   npx supabase@2.122.0 link --project-ref ugifdvaaaioiqmwfiksw        # asks for the database password: type it at the hidden prompt
   npx supabase@2.122.0 migration list                                  # remote shows 20261101102513 and 20261101102527
   npx supabase@2.122.0 migration repair --status reverted 20261101102513 20261101102527
   npx supabase@2.122.0 migration repair --status applied  20261101000100 20261101000200
   npx supabase@2.122.0 db push --dry-run                                # MUST list exactly 20261101000300 … 20261105000100 (seven files)
   npx supabase@2.122.0 db push                                          # type Y only after reading that list
   ```
   (The two `repair` lines only fix the bookkeeping so that migrations 1 and 2 are recorded under the repository's names; they change no schema.)
Then tell me, and I run the post-migration checks below (read-only).

## Preconditions (all must hold; I re-check them read-only immediately before writing)
1. The project ref in every command is exactly `ugifdvaaaioiqmwfiksw`, and `list_projects` shows it as the only project with that ref.
2. `public` still has 0 tables and 0 migrations; `auth.users` still has 0 rows. (If anyone has signed up, **stop**: this runbook is for an empty project.)
3. You have said **"apply the nine migrations to ugifdvaaaioiqmwfiksw"**. (Nine files: the eight migrations plus the additional helper-function privilege fix.)
4. The **Email provider is off** (so no sign-up path other than Google exists). Not required for the migrations themselves; required before accounts go live.

## What is written
Only schema objects in `public` (tables, functions, policies, triggers, grants) and rows in `supabase_migrations.schema_migrations`. **No user data, no Auth settings, no keys.** Accounts stay disabled in the app throughout; students see nothing change; downtime for students: **none**. Estimated time: 5 to 10 minutes.

## Method (I run it; you supply no credentials)
Through the Supabase connector's `apply_migration`, **one migration per call, in this order, using the exact file contents from the repository at the merged commit**, stopping at the first error or surprise. The connector registers each with its own version timestamp and the file's name; the readiness check therefore compares by name.

| # | Migration name (file) | What it does |
|---|---|---|
| 1 | `core_schema` (`20261101000100`) | revokes default grants; `profiles`, `consents`, `invitations`, `invitation_reservations`, `app_admins`, `audit_events`, `deletion_ledger`; RLS; the learner gate |
| 2 | `invitations` (`20261101000200`) | reserve / redeem / revoke invitation functions |
| 3 | `learner_documents` (`20261101000300`) | saved-progress documents, 10-revision history, validated compare-and-swap `put_document` |
| 4 | `deletion_and_cleanup` (`20261101000400`) | `delete_learner`, `orphan_identities` |
| 5 | `auth_support` (`20261101000500`) | rate limiting, release, purge, `create_invitation` |
| 6 | `owner_tools` (`20261102000100`) | `expire_invitation` |
| 7 | `sync_consent` (`20261103000100`) | `record_consent`, consent-gated `put_document` |
| 8 | `lifecycle` (`20261104000100`) | export audit, restore-replay functions, owner-safe `delete_learner`, bounded rate limit |
| 9 | `revoke_platform_helper` (`20261105000100`) | **the additional privilege fix**: revokes client `EXECUTE` on `public.rls_auto_enable()` (a no-op if it does not exist; the platform's automatic RLS on new tables keeps working because an event trigger does not need the caller's EXECUTE right) |

**Alternative if you prefer to run it yourself** (no connector): in a terminal on your machine, `npx supabase@2.122.0 login` (browser), `npx supabase@2.122.0 link --project-ref ugifdvaaaioiqmwfiksw` (asks for the database password; type it at the hidden prompt, never in chat), then `npx supabase@2.122.0 db push` and read the listed nine migrations **before** typing `Y`. It needs no Docker. Version numbers then match the file names.

## Post-migration checks (read-only; all must pass or I stop and report)
**A. Migration history:** exactly nine rows, names as above, no others.
**B. Tables:** exactly ten in `public`: `app_admins`, `audit_events`, `consents`, `deletion_ledger`, `invitation_reservations`, `invitations`, `learner_document_versions`, `learner_documents`, `profiles`, `rate_limits`; **every one has row-level security enabled**.
**C. Table privileges** (`has_table_privilege`): `anon` holds **no** privilege on any `public` table; `authenticated` holds table-level `SELECT` on `consents`, `learner_documents`, `profiles` and **nothing else**; column-level `UPDATE` for `authenticated` on `profiles` is exactly `display_name, first_language, time_zone, preferences`.
**D. Function privileges** (`has_function_privilege`): `anon` can execute **no** `public` function; `authenticated` can execute **only** `is_active_learner` and `is_admin`; every other function (including `put_document`, `delete_learner`, `redelete_learner`, `reserve_invitation`, `rate_limit_hit`, `rls_auto_enable`) is `service_role`-only.
**E. Security advisor:** **zero** findings (the two `rls_auto_enable` warnings are gone). Performance advisor: none.
**F. Anonymous Data API** (public key, GET): `/rest/v1/profiles`, `…/consents`, `…/learner_documents`, `…/invitations` each refused or empty; the API description lists nothing.
**G. No data:** `auth.users` 0, every `public` table 0 rows.
**H. App unchanged:** the production site still serves the anonymous app; account/sync/transfer routes still 404 on `www.grammigo.si`, `grammigo.si` and `grammigo.vercel.app`.
The same assertions run in CI against the local database on every change (`catalogue`, `isolation`, `rest`, and the readiness checks), and on production they are repeated by these queries. Equivalent one-command form on your machine once migrations are in: `node scripts/check-production-readiness.mjs db` (read-only transaction; asks for the connection string only through your environment).

## Recovery
* **A migration fails halfway:** each call is one transaction; nothing partial. I report the error text (no secrets) and stop. Fix is a corrected file, reviewed, never an edit on the server.
* **Check fails after all nine:** while the database is empty and has no users, the schema can be reset (`drop schema public cascade; create schema public;` + grants + clearing the migration history) and re-applied from #1. That deletes only schema objects I just created; I do it only on your instruction. After the first real user exists there is **no** down-migration: fixes go forward, data recovery is from the encrypted backup (`scripts/backup/`).
* **Nothing about Auth, Google or the domain is touched by any of this.**

## Right after the migrations (before any invitation)
1. You take the first **encrypted backup** (empty project, proves the tool against production): `node scripts/backup/backup.mjs --out ~/grammigo-backups/first-empty.gmbackup` in a terminal in your Linux home (not `/mnt/c`, not inside the repository). It asks for the connection string and a passphrase without echoing either. Save the passphrase in your password manager.
2. Vercel Production variables, then the `env` readiness check.
3. The acceptance run with disposable Google accounts, then you say "enable accounts".


## Migration 10 (NEW, needs its own authorization): `email_password` (`20261106000100`)
Adds three server-only functions and two columns for **Email + Password** sign-in: `reserve_invitation_for_email`, `redeem_reservation_for_email`, `email_identity_state`, and `email_hash` / `adult_confirmed_at` on `invitation_reservations`. It is **not** in the nine already authorized and is **not** applied. It is merged to `main` only with the Email + Password pull request; apply it after that pull request is merged and CI is green, with the same method and the same post-migration checks (the function-privilege check then also expects these three to be `service_role`-only, as in the catalogue test). Until it is applied and the app deployed with accounts off, nothing depends on it.
