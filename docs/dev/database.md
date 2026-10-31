# Database (v0.4 Phase 2): migrations, schema decisions, tests

Local Supabase only. No cloud project exists. Production provisioning, Google OAuth, DNS and deployment of the account backend are separate, later approvals.

## Migrations (`supabase/migrations`, applied in order by `supabase start` / `supabase db reset`)
| File | What it does |
|---|---|
| `20261101000100_core_schema` | tables (`app_admins`, `invitations`, `invitation_reservations`, `profiles`, `consents`, `audit_events`, `deletion_ledger`), RLS on every table, the learner gate `is_active_learner()`, `is_admin()`, explicit privileges |
| `20261101000200_invitations` | `reserve_invitation`, `redeem_invitation`, `revoke_invitation` (transactional, row-locked) |
| `20261101000300_learner_documents` | `learner_documents` + `learner_document_versions`, `valid_document`, `put_document` (compare-and-swap), `restore_document_revision` |
| `20261101000400_deletion_and_cleanup` | `delete_learner` (writes the ledger and deletes in one step), `orphan_identities` |

## Decisions that matter
* **Deny by default.** Supabase grants every new public object to `anon`/`authenticated`. The first migration revokes that for existing and *future* objects (including the global `EXECUTE` to `PUBLIC` default on functions), then grants back only what is listed. The catalogue test fails if anything else appears.
* **Learners can only read** their own profile, consents and documents, and update four profile columns (display name, language, time zone, preferences). `status`, `adult_confirmed_at`, `joined_via_invitation` and every write to documents are server-only.
* **`is_active_learner()` is the gate on every learner policy.** A Google sign-in creates an `auth.users` row with no profile; for that "intermediate identity" the function is false, so RLS returns nothing and writes nothing anywhere.
* **Invitations are redeemed in one transaction** that also creates the profile and consents. Reservation holds expire (30 min) and are released lazily; revocation cancels pending holds.
* **Documents are validated twice:** by the server (zod) and by the database (`valid_document` in a CHECK and in `put_document`). A missing key is *invalid*, never "passes" (a NULL-comparison bug the tests caught).
* **Compare-and-swap + history:** `put_document` needs the expected revision; the newest 10 revisions are kept; `restore_document_revision` writes an old body as a new revision.
* **Deletion ledger:** a hashed id, immutable (no updates, no deletes for 35 days), no client access. `audit_events` is append-only except clearing the actor link when an account is deleted.
* **Every `SECURITY DEFINER` function pins `search_path`.**

## Tests
```
npm run test:db        # needs the local stack: npx --yes supabase@2.122.0 start
```
It FAILS (never skips) if Supabase is unavailable, the migrations are not applied, or any authorisation check fails.
* `supabase/tests/sql/*`: catalogue (every table and function must be listed with who may use it), isolation (learners A and B, an intermediate identity, the admin, anon, the server), invitations (concurrency, expiry, abandonment, revocation, a redeem/revoke race), documents (validation, compare-and-swap, concurrent writers, history, recovery), deletion (cascade across every table, ledger immutability, audit append-only, orphan identities).
* `supabase/tests/api/rest.test.ts`: the same guarantees through the real HTTP surface (Auth + REST) with real session tokens.
* CI job **Database isolation** starts the stack on the runner's Docker and runs `npm run test:db`.

Test users are created with a local-only password through the local Auth admin API, because Google sign-in cannot run locally. This is test scaffolding only; production has the Email provider off.
