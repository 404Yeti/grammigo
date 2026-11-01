# Read-only inspection of the production Supabase project, 2026-11-01

Method: the Supabase connector (hosted MCP, owner-installed) used through a **separate, locked-down Claude Code process** whose allowed tools were limited to: `list_organizations`, `get_organization`, `list_projects`, `get_project`, `list_tables`, `list_migrations`, `list_extensions`, `get_advisors`, `get_project_url`, `list_branches`. Explicitly **not** allowed (and denied by rule): `execute_sql`, `apply_migration`, every `create_/delete_/merge_/rebase_/reset_/restore_/pause_` tool, `get_publishable_keys`, `query_logs`, secrets, Bash and file writes. The connector being installed was **not** assumed to prove access: the first step was an identity check, and a nested session first reported (correctly) that the tools were not yet loaded; they were only used after they were found. **No change of any kind was made to the project**, and no key, secret, password or connection string was requested or printed.

## Verified
| Fact | Value | Matches the plan? |
|---|---|---|
| Identity | Project ref `ugifdvaaaioiqmwfiksw` is in the account's project list; it is the only project; id and ref match exactly | yes |
| Name / status | `supabase` / ACTIVE_HEALTHY | n/a |
| Created | 2026-10-31 | n/a |
| **Region** | **ap-southeast-1 (Singapore)** | **yes** (was an unverified assumption) |
| Organisation | `grammigo` (id `pmqcktjhokuakvwqahip`) | n/a |
| **Plan** | **Free** (`tier_free`) | **NO**: see "Changes to the plan" |
| Postgres | 17.11.0.016 (local stack is 17) | yes |
| Postgres release channel | **`withdrawn`** (Supabase has withdrawn this build) | to check: see below |
| `public` schema | **empty** (0 tables) | yes |
| Application migrations applied | **none** | yes |
| Auth users | **0** (every `auth` table except migrations has 0 rows) | yes |
| Extensions installed | `plpgsql`, `pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault` (`pg_graphql` is **not** installed) | yes, with a correction to the pre-flight list |
| Branches | none | n/a |
| Performance advisor | no findings | n/a |

## Findings
1. **`public.rls_auto_enable()` already exists.** It is a platform helper (the project was created with automatic row-level security, an event trigger that turns RLS on for new tables). The security advisor flags it twice (WARN): `anon` and `authenticated` can execute it through `/rest/v1/rpc/rls_auto_enable`. It is harmless to our model (RLS on new tables is what we want, and our migrations also enable RLS explicitly), but it is a **public-schema function with client execute rights that our privilege checks did not expect**. Plan: a small forward migration that revokes execute from `public, anon, authenticated` (a no-op when the function does not exist, as on the local stack), and the privilege check now expects exactly this one platform function to be present (see `migration-plan.md`).
2. **The project is on the Free plan.** See below.
3. **The Postgres build is in the `withdrawn` release channel.** The response does not say why. Before migrating, check the dashboard for an offered upgrade and apply it **while the database is empty** (an upgrade on an empty project is the cheapest it will ever be).
4. Auth tables: 11 newer `auth` tables have RLS disabled (OAuth server, WebAuthn, SCIM, MFA recovery). They are platform-managed, empty and not exposed by the Data API, and not ours to change; recorded only so nobody is surprised later.

## Not obtainable through the connector (still open)
Backup schedule, retention and point-in-time-recovery status; compute size and disk usage; the billing details beyond the plan name; auth provider and URL settings; RLS policies and function grants (reading them needs SQL, which was not allowed); edge functions, storage, logs. The owner can read the first two groups on the dashboard (Database → Backups; Settings → Billing) and the auth settings are covered by the scripted check added in the Phase 7B preparation PR.

## Changes to the rollout plan
* **Upgrade the organisation to Pro before any real data exists, and before enabling accounts.** The Free plan has **no automatic daily backups** and **pauses a project after a week of inactivity** (provider documentation, 2026-11-01): either is unacceptable for a production app holding students' progress and for the "restore a deleted person" promise. Pro is $25/month (7-day daily backups, $10 compute credit covering one Micro instance). This was an assumption in Phase 7A ("if it is Pro"); it is now a **hard gate**. The restore-drill plan keeps its scratch projects in a separate organisation.
* **Region is now verified as Singapore**, so the latency finding in the readiness report is real, not conditional. The Vercel function region should be set to `sin1` (the nearest Vercel region), after a measurement in 7C confirms it helps. The preparation PR's region tool accepts this as a verified fact.
* **Pre-flight corrections** (`migration-plan.md`): the expected extensions are the five above, not including `pg_graphql`; the privilege check allows `rls_auto_enable` to exist until the revoke migration is applied; add "Postgres release channel is not `withdrawn`, or the upgrade has been applied" to the pre-flight.
* **No other change:** schema empty, no users, no migrations: the migration order and rollback plan stand.
