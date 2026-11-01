# Production migration runbook (Supabase Free) — NOT EXECUTED; for the owner's authorization

Target: Supabase project **`ugifdvaaaioiqmwfiksw`** (region ap-southeast-1, organisation `grammigo`, Free plan). Facts checked read-only on 2026-11-02: project ACTIVE_HEALTHY; `public` schema empty (0 tables); 0 applied migrations; `auth.users` 0 rows; 5 extensions (`plpgsql`, `pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault`); no branches; the only security findings are the two warnings on `public.rls_auto_enable()`.

## STATE AS OF 2026-11-02 (read this first)
**Established by a read-only inspection (SELECT-only; nothing written), 2026-11-02:**
* Migration history holds exactly two rows: `20261101102513 core_schema` and `20261101102527 invitations` (registered by the connector under its own version numbers, not the repository's `20261101000100` / `…000200`).
* `public` holds exactly the seven tables of migrations 1 and 2 (`app_admins`, `audit_events`, `consents`, `deletion_ledger`, `invitation_reservations`, `invitations`, `profiles`), all with row-level security; nine functions (`audit_events_guard`, `deletion_ledger_guard`, `is_active_learner`, `is_admin`, `redeem_invitation`, `reserve_invitation`, `revoke_invitation`, `rls_auto_enable`, `touch_updated_at`).
* **Migration 3 left no trace:** no `learner_documents`, no `learner_document_versions`, none of `valid_document` / `put_document` / `restore_document_revision`, and no history row. The connector's cancellation happened before anything ran. The history and the schema agree: **migrations 1 and 2 are in, 3 to 9 are not.**
* `auth.users` 0, `profiles` 0, `invitations` 0, `audit_events` 0. No data.
* Advisors (before migrations 3 to 9): 2 WARN for `is_active_learner()` / `is_admin()` being executable by `authenticated` (intended: row-level security needs them; they return only a boolean about the caller), 3 WARN "search_path mutable" on `touch_updated_at`, `audit_events_guard`, `deletion_ledger_guard`, plus INFO items. These are re-assessed after the migrations (check E below) and anything unexpected is reported, not worked around.
* Not touched, by decision: migrations 1 and 2 are **not** reset and **not** re-applied.

**Nothing may be written to production until you confirm this state.** The procedure below is for you to run in a terminal. It never uses `supabase migration repair` and never `db push`, because the CLI would see the two remote version numbers as unknown and the repository's first two files as unapplied, and offer to re-apply migrations 1 and 2.

### Applying ONLY migrations 3 to 9 from a terminal (WSL, `psql`)
Use the script `scripts/ops/apply-production-migrations.sh`, run from a **separate checkout of `main` at `025173d`** in your Linux home (`~/grammigo-prod-migrate`; it does not disturb your working branch), so the folder holds exactly the nine approved files and not the tenth.

For each of migrations 3 to 9 it runs ONE transaction (`psql --single-transaction`) containing, in order: **(1) the state guard, (2) the migration file, (3) its history row.** If the guard or the file fails, the transaction is rolled back and nothing, including the history row, is kept; the script stops. It never uses the Supabase CLI, `db push` or `migration repair`, and never touches migrations 1 and 2.

The guard (inside that transaction) refuses unless: the database is `postgres`; the migration history is **exactly** the expected rows (the two connector rows plus those this script has already added); `auth.users` has 0 rows; and (for migration 3) `public` holds exactly the seven base tables. Before anything is written the script also checks: HEAD is exactly `025173d`, tracked files unmodified, exactly nine migration files, none with its own `begin`/`commit`; `PGUSER` is exactly `postgres.ugifdvaaaioiqmwfiksw` (the project reference is part of the pooler user name, so another project cannot answer to it), the host is a Supabase pooler host, the port is 5432 (session mode). In `apply` mode you must also **type the project reference**. The password is read at a hidden prompt, exported only inside the script process, unset on exit, and never written to a file, shell history or log.

Rehearsed against a throwaway local PostgreSQL 17 with stand-in tables: the guard passes on the right state, refuses a wrong history, refuses when a user exists; a migration that fails halfway leaves no table and no history row; a re-run is refused. It could not be run against a real Supabase instance, so `check` mode is your first, read-only, exercise of it.

Commands: `./apply-production-migrations.sh check` (read-only), then `./apply-production-migrations.sh apply`.

**What this does not do, on purpose:** it does not change the two existing history rows. They keep the connector's version numbers, so a later CLI `db push` would not recognise them; that is **your decision, not an automatic step** (the fix would be `migration repair`, after looking at `migration list`). The readiness checks compare by **name**, so nothing depends on it.

When migration 9 is in, tell me, or run `node scripts/check-production-readiness.mjs db` yourself; I run the checks A to H below (read-only) and **accounts stay disabled throughout**.

## Preconditions (all must hold; I re-check them read-only immediately before writing)
1. The project ref in every command is exactly `ugifdvaaaioiqmwfiksw`, and `list_projects` shows it as the only project with that ref.
2. History holds exactly the two rows above, `public` holds exactly the seven tables above, and `auth.users` has 0 rows. (If anyone has signed up, **stop**: this runbook is for an empty project.)
3. You have said **"apply the nine migrations to ugifdvaaaioiqmwfiksw"**. (Nine files: the eight migrations plus the additional helper-function privilege fix.)
4. The Email provider stays **on** (decision: an email-and-password student). It is not a blocker for these migrations. Before accounts go live the readiness `auth` check must pass with Google and Email enabled and email confirmation required.

## What is written
Only schema objects in `public` (tables, functions, policies, triggers, grants) and rows in `supabase_migrations.schema_migrations`. **No user data, no Auth settings, no keys.** Accounts stay disabled in the app throughout; students see nothing change; downtime for students: **none**. Estimated time: 5 to 10 minutes.

## The seven outstanding migrations (3 to 9) and what each does
Run by you in a terminal as above (or in an interactive connector session where you press yes on each confirmation). Same files, same order.

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

## Post-migration checks (read-only; all must pass or I stop and report)
**A. Migration history:** exactly nine rows with the nine names above (two under the connector's version numbers, seven under the repository's), no others.
**B. Tables:** exactly ten in `public`: `app_admins`, `audit_events`, `consents`, `deletion_ledger`, `invitation_reservations`, `invitations`, `learner_document_versions`, `learner_documents`, `profiles`, `rate_limits`; **every one has row-level security enabled**.
**C. Table privileges** (`has_table_privilege`): `anon` holds **no** privilege on any `public` table; `authenticated` holds table-level `SELECT` on `consents`, `learner_documents`, `profiles` and **nothing else**; column-level `UPDATE` for `authenticated` on `profiles` is exactly `display_name, first_language, time_zone, preferences`.
**D. Function privileges** (`has_function_privilege`): `anon` can execute **no** `public` function; `authenticated` can execute **only** `is_active_learner` and `is_admin`; every other function (including `put_document`, `delete_learner`, `redelete_learner`, `reserve_invitation`, `rate_limit_hit`, `rls_auto_enable`) is `service_role`-only.
**E. Security advisor:** **zero** findings (the two `rls_auto_enable` warnings are gone). Performance advisor: none.
**F. Anonymous Data API** (public key, GET): `/rest/v1/profiles`, `…/consents`, `…/learner_documents`, `…/invitations` each refused or empty; the API description lists nothing.
**G. No data:** `auth.users` 0, every `public` table 0 rows.
**H. App unchanged:** the production site still serves the anonymous app; account/sync/transfer routes still 404 on `www.grammigo.si`, `grammigo.si` and `grammigo.vercel.app`.
The same assertions run in CI against the local database on every change (`catalogue`, `isolation`, `rest`, and the readiness checks), and on production they are repeated by these queries. Equivalent one-command form on your machine once migrations are in: `node scripts/check-production-readiness.mjs db` (read-only transaction; asks for the connection string only through your environment).

## Recovery
* **A migration fails halfway:** each file runs in one transaction (`--single-transaction`); nothing partial. I report the error text (no secrets) and stop. Fix is a corrected file, reviewed, never an edit on the server.
* **Check fails after all nine:** no reset. Migrations 1 and 2 are never re-applied and the database is never dropped. I report the failing check; the fix is a new, reviewed, forward migration that you authorize separately. After the first real user exists there is no down-migration at all: data recovery is from the encrypted backup (`scripts/backup/`).
* **Nothing about Auth, Google or the domain is touched by any of this.**

## Right after the migrations (before any invitation)
1. You take the first **encrypted backup** (empty project, proves the tool against production): `node scripts/backup/backup.mjs --out ~/grammigo-backups/first-empty.gmbackup` in a terminal in your Linux home (not `/mnt/c`, not inside the repository). It asks for the connection string and a passphrase without echoing either. Save the passphrase in your password manager.
2. Vercel Production variables, then the `env` readiness check.
3. The acceptance run with disposable Google accounts, then you say "enable accounts".


## Migration 10 (NEW, needs its own authorization): `email_password` (`20261106000100`)
Adds three server-only functions and two columns for **Email + Password** sign-in: `reserve_invitation_for_email`, `redeem_reservation_for_email`, `email_identity_state`, and `email_hash` / `adult_confirmed_at` on `invitation_reservations`. It is **not** in the nine already authorized and is **not** applied. It is merged to `main` only with the Email + Password pull request; apply it after that pull request is merged and CI is green, with the same method and the same post-migration checks (the function-privilege check then also expects these three to be `service_role`-only, as in the catalogue test). Until it is applied and the app deployed with accounts off, nothing depends on it.
