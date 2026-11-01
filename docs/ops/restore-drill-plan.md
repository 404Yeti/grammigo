# Backup-restore drill: can the plan support one, and a method that cannot touch production data

## What the plan supports (provider documentation, checked 2026-11-01)
* **Free:** no automatic daily backups; the docs tell free projects to export with `supabase db dump`. 2 active projects per organisation. Paused after a week idle.
* **Pro ($25/month):** daily backups kept **7 days**; **PITR** is an add-on (about $100/month for 7 days, needs at least a Small compute) and **replaces** daily backups while enabled. Projects on Postgres 15.8.1.079 and later use *physical* backups, which cannot be downloaded; to get a downloadable logical backup you use `supabase db dump` / `pg_dump`.
* The production project's plan was read on 2026-11-01: **Free**, which has **no automatic backups** (and pauses after a week idle). It must be upgraded to Pro before real data exists (`production-inspection-2026-11-01.md`). Everything below that needs backups assumes Pro.
* Daily backups do **not** include custom role passwords. Grammigo creates none, but the drill confirms nothing depends on them.

## Is a meaningful drill possible? Yes, on scratch projects. No, on production.
A meaningful drill must prove (a) a backup can be restored, (b) a person deleted after the backup is deleted again by the ledger replay, (c) the app works against the restored database. None of that needs production data, and **none of it may be done on production** (restoring in place overwrites live data).

### Method (two tracks; both on throw-away projects, both with synthetic identities)
**Setup (once):** create `grammigo-drill-a` and `grammigo-drill-b` in a **separate Supabase organisation** (so no tool can confuse them with production) and give them names that cannot be mistaken. Use a different `INVITE_CODE_PEPPER` etc. than production. No real person's data ever enters them.

**Track 1: logical restore (works on any plan; same day).**
1. On A: apply the 8 migrations; create 3 synthetic learners (service-role script or the e2e helpers), put documents for each (`put_document`), and one owner.
2. `pg_dump` A (schemas `public` and `auth`, data included) through the session pooler connection string. Keep the file local, encrypted, deleted after the drill.
3. On A, delete learner X through the app's own deletion path (so the ledger entry is written). Export A's ledger (`\copy … deletion_ledger`).
4. Restore the dump into **B** (fresh project, migrations applied or dump includes them). X is back.
5. Insert A's exported ledger into B, then run `scripts/replay-deletions.mjs` (dry run, then `--apply`) with A's pepper. Expect: X gone with no orphan rows; the others intact; second run deletes nothing; wrong pepper deletes nobody.
6. Point a preview deployment of the app (accounts on, B's keys) at B; sign in as a surviving learner; confirm lessons, sync and export work.

**Track 2: provider restore (needs Pro on the scratch org; the realistic recovery path).**
1. Upgrade only `grammigo-drill-a` to Pro (prorated; cancel after).
2. After the first daily backup exists (next day), use the dashboard's restore of that backup into a **new** project (not in place), or in place on A only. Repeat steps 3 and 5 above. Record how long it took and what the dashboard warned about.
3. Record the provider's actual **RPO/RTO** observed.

**What this does not prove:** that production's own backups exist or are healthy (check in the dashboard on the day: list shows the latest backup time), or point-in-time recovery (not planned for the pilot).

### Acceptance for the drill
* Replay deletes exactly the ledgered people, idempotent, owners safe (already tested in CI, now on a real restore).
* Restore completes within the owner's stated tolerance (the original plan accepted RTO/RPO of 24 hours).
* A written run-sheet with the real timings replaces the estimates in `docs/dev/deletion-and-restore.md`.
* All scratch projects deleted and the dump file shredded afterwards.

### Cost
Free-plan track 1: **$0** (two free projects in one free org). Track 2: one Pro org for about a day: $25 (monthly minimum) prorated to a day or two, plus the scratch project's compute beyond the included credit (about $10/month prorated, cents for a day): **about $1 to $25 depending on how billing prorates; cancel the same day.** PITR is **not** needed for the pilot.

### Recommendation
Do Track 1 before the first student (cheap, deterministic, scriptable) and Track 2 once, before the pilot grows beyond a handful of people. Neither needs a production credential.
