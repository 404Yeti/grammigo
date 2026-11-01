# Activation checklist: the shortest safe path to the first five adult students

Decision (owner, 2026-11-02): **stay on Supabase Free.** No Pro upgrade, no paid add-ons, no paid backups as a launch requirement. Student progress stays local-first and exportable. This file replaces the earlier phase plans for the purpose of launching; those documents (`migration-plan.md`, `google-oauth-and-config.md`, `domain-and-guest-transfer-plan.md`, …) remain the detail behind each step.

Status words: **DONE** (built, tested in CI, merged), **YOU** (needs you at a dashboard or a decision), **APPROVE** (I do it once you say go), **WAIT** (cannot be done until something earlier is).

## What a Free project means for launch (checked 2026-11-02)
| Free-plan fact | What we do about it |
|---|---|
| **No automatic backups** | Manual encrypted backup tool (`scripts/backup/`, tested), run before the first invitation and then weekly. Copies kept at most 35 days. Learners can also export their own data. |
| **Paused after about a week of low activity** (resumable within 90 days) | Real students use it daily. A nightly cleanup job (`vercel.json` cron, runs on Vercel Hobby too) also touches the database every day. Check the pause-warning email address in the Supabase org settings is yours. |
| No point-in-time recovery, no "restore to new project" | Recovery = restore the latest manual backup into an empty project (`restore.mjs`), then replay the deletion ledger. Tested against a real database in CI. |
| Postgres build is in the `withdrawn` channel | Not a known blocker (the project is healthy and the SQL is plain). Look at **Settings → Infrastructure**: if an upgrade is offered, take it **before** the migrations (the database is empty, so it is the cheapest it will ever be). If none is offered, proceed. |

## Verified by the read-only preflight (connector, 2026-11-02)
Project `ugifdvaaaioiqmwfiksw` exists and is the only project; status ACTIVE_HEALTHY; region ap-southeast-1; organisation `grammigo`, plan Free; Postgres 17.11 (channel `withdrawn`); `public` empty; no migrations; no users; 5 extensions; no branches; the only security findings are the two warnings on the platform helper `rls_auto_enable()`, which the last migration revokes. **Not visible through the connector:** auth provider settings, backups (none on Free), upgrade eligibility. Nothing was written.

## The sequence

### Step 0. Merge what is built — DONE / in review
PR #18 merged. PR #20 (timeouts, transfer, readiness checks, migration 9, region tool) is green apart from two CodeQL review threads that I fixed in code (the variables-file change); once its CI is green and the threads are closed it merges. PR "backup + journey + disclosures" follows. No production setting changes by merging.

### Step 1. You, at the Supabase dashboard (about 10 minutes, no downtime, nothing written)
1. **Settings → Infrastructure:** is "Upgrade project" offered? Tell me yes/no (a screenshot is fine). If yes, and you approve, you click it (about 5 to 15 minutes of database downtime; nothing depends on it yet).
2. **Authentication → Providers:** note what is on. Leave Google off for now. **Turn Email off** (and Phone and every other provider) if they are on.
3. **Authentication → Sign In / Providers → "Allow new users to sign up"** must stay ON (Google sign-in needs it; the app itself refuses people without an invitation).
4. **Authentication → URL Configuration:** Site URL `https://grammigo.si`; redirect allow-list exactly `https://grammigo.si/api/auth/callback**` and nothing else.
5. **Authentication → Sessions:** JWT expiry 3600 seconds (default).
6. **Organisation settings:** confirm the billing/notification email is one you read (pause warnings go there).
You never need to show me a key. I will check the result with the read-only connector and the `auth` readiness check.

### Step 2. First backup (empty project) and the migrations — APPROVE (one production write)
Prerequisite: Step 1 done; you say **"apply the eight migrations plus the helper fix"**.
Order, applied by me through the connector with the repository's exact files, one at a time, stopping at the first surprise:
1. `20261101000100_core_schema` 2. `…000200_invitations` 3. `…000300_learner_documents` 4. `…000400_deletion_and_cleanup` 5. `…000500_auth_support` 6. `20261102000100_owner_tools` 7. `20261103000100_sync_consent` 8. `20261104000100_lifecycle` 9. `20261105000100_revoke_platform_helper` (the **additional helper-function privilege fix**: removes client execute on `public.rls_auto_enable()`; the platform's automatic RLS keeps working).
After the last one, I run the post-migration checks (read-only): the security advisor must show **no** findings; `check-production-readiness.mjs db`-equivalent queries via the connector (10 tables, RLS on every one, anon has no privilege, learners hold only their three SELECTs and four profile columns, no unexpected function executable); migration history has exactly nine rows. **Downtime:** none for students (accounts are off and lessons never use the database). **Rollback:** while the database is empty and has no users, the schema can be reset and re-applied (`migration-plan.md`); I do that only on your instruction.

### Step 3. Google OAuth — YOU (about 15 minutes) then APPROVE
**You:** create the Google Cloud project/consent screen/OAuth client exactly as `google-oauth-and-config.md` §1 (External, scopes `openid email profile` only, Testing mode with your disposable test accounts as test users; one redirect URI `https://ugifdvaaaioiqmwfiksw.supabase.co/auth/v1/callback`; no JavaScript origins). Paste the **Client ID and Client secret only into the Supabase dashboard** (Authentication → Providers → Google). Never into chat. Tell me "Google is configured".
**Then I (read-only):** run the `auth` check: Google on, no other provider, sign-ups allowed. Testing mode is enough for the first five adults **if they are added as Google test users** (limit 100); publishing the consent screen and Google's brand verification are **not** launch blockers for five named people, but unlisted people will see Google's "unverified app" warning until then.

### Step 4. Vercel production configuration — YOU (about 10 minutes) or APPROVE
Minimum, **Production environment only** (not Preview, not Development), each marked Sensitive: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_CODE_PEPPER`, `AUTH_FLOW_SECRET`, `CRON_SECRET`, `AUTH_SITE_URL=https://grammigo.si`. Generate the three random ones in your own terminal (`openssl rand -base64 48`), keep `INVITE_CODE_PEPPER` in your password manager (it also keys the deletion ledger: do not lose or rotate it). Do **not** set `NEXT_PUBLIC_ACCOUNTS` yet. Paste the three Supabase values from the Supabase dashboard's API page straight into Vercel. Then run `node scripts/check-production-readiness.mjs env` in your terminal (with `vercel env pull` output loaded via `--vars-file`, deleted afterwards) and send me the PASS/FAIL output (it prints no values).
Region: **leave the function region as is.** Moving to `sin1` is optional and is not a launch blocker for five students (see the performance note below).
`vercel.json` with the nightly cleanup/keep-alive cron: a one-file PR I prepare with `scripts/vercel-region.mjs --supabase-region ap-southeast-1 --with-cron` minus the region (cron only), merged on your approval.

### Step 5. grammigo.si — YOU at the registrar, then APPROVE
Today `grammigo.si` points at two parked AWS addresses and HTTPS to it times out. After you approve: (a) at the registrar lower the TTL to 300 s; (b) I add `grammigo.si` (and `www` → redirect to apex) to the Vercel project with **no redirect from grammigo.vercel.app**; (c) **you** replace the two A records with the values Vercel shows for the project (Project → Domains), and Vercel issues the HTTPS certificate by itself within minutes. **Downtime:** none for grammigo.vercel.app, which keeps working untouched. Rollback: restore the old records.
**Existing guest progress:** nothing is redirected, so nobody loses anything. Guest progress on grammigo.vercel.app moves by the built, tested, off-by-default transfer (one tap, preview, explicit confirm, file fallback) once `NEXT_PUBLIC_GUEST_TRANSFER=on` is set for the Production build (Step 6). The five new students start on grammigo.si, so they have no old progress to move. Redirecting the old address and a banner pointing guests to the transfer are **after-launch** work, not blockers.

### Step 6. Turn accounts on for the Production build — APPROVE (the production go-live switch)
Prerequisites: Steps 1 to 5 done; a first encrypted backup taken (below); the **acceptance test** below passed. You say **"enable accounts"**; I (or you) set `NEXT_PUBLIC_ACCOUNTS=on` (and `NEXT_PUBLIC_GUEST_TRANSFER=on`) in Vercel Production and redeploy. **Downtime:** none (a normal deploy; the site stays up while it builds). **Rollback / kill switch:** set `NEXT_PUBLIC_ACCOUNTS` back to anything but `on` and redeploy (a few minutes): every account page and route returns 404 again, and anonymous learning never changes.

### Step 7. Acceptance with disposable accounts — YOU + me (about 45 minutes), BEFORE any student is invited
Needs: your owner account and **two disposable Google accounts** you control (T1, T2), added as Google test users.
1. (me) Take the encrypted backup of the empty project and prove it restores (dry run).
2. Owner creates a one-seat invitation in the app. T1 opens `https://grammigo.si/join`, enters the code, ticks 18+, continues with Google, lands on the dashboard.
3. T1 edits the profile, completes a lesson, turns saving on, sees "Saved to your account", signs out.
4. T1 signs in again **from a different browser/phone**: the lesson progress is there.
5. T2 (uninvited) signs in with Google: "No account yet", nothing created. The used code cannot be reused.
6. T1 downloads their data (only T1's), then deletes the account (the sign-in-again step works).
7. Check afterwards (read-only, me): T1 and T2 leave no rows; the deletion ledger has one entry; advisor still clean.
8. **Physical iPhone Safari**, the same journey once (`docs/dev/real-device-acceptance.md`, plus the transfer: on the iPhone open `https://grammigo.si/transfer/receive`, bring progress from `grammigo.vercel.app` by the pop-up and, if the pop-up is blocked, by the file).
Pass = every step as written. A failure becomes a fix, not a workaround.
**What is already proven before this**, in CI on every change: the whole journey except Google's own consent screen runs end to end on a real local stack (`e2e-accounts/student-journey.spec.ts`: invitation → real Google redirect → redeem → profile → lesson with **zero** account requests while answering → sync after the finished lesson → sign out → fresh device → progress restored → export → delete); no data crosses learners (isolation suites for every table and endpoint, the export/delete tests with two learners side by side); a **hung or refused Supabase never blocks a lesson or Guided Correction** (browser tests with a refusing server and a black-hole server; lessons complete in about 1 to 2 seconds while Supabase is dead).

### Step 8. Invite the first five — APPROVE
You create five one-seat invitations (or one five-seat) in the app, send the links yourself, and add each student's Google address to the Google test users (needed only while the consent screen is in Testing). Take a backup the day before and weekly after.

## Backup and recovery procedure (Free plan), tested
* **Back up** (read-only against the database; run on your machine; **never inside the repository**; files are `*.gmbackup`, gitignored):
  `SUPABASE_DB_URL=… BACKUP_PASSPHRASE=… node scripts/backup/backup.mjs --out ~/grammigo-backups/2026-11-02.gmbackup`
  The connection string is in Supabase → Connect (use the **session pooler** string if your network has no IPv6). Use a passphrase of 16+ characters from your password manager. The file is encrypted and owner-readable only. Keep a second copy somewhere that is not your laptop. **Delete copies older than 35 days.**
* **When:** before the first invitation, then **weekly**, and before any manual database change.
* **Recover** (project lost, corrupted, or deleted): create a new Supabase project, apply the nine migrations, then
  `… node scripts/backup/restore.mjs --file X.gmbackup` (dry run, nothing written), then `--apply`, then `node scripts/replay-deletions.mjs --apply` with the app's pepper (anyone deleted in the meantime is deleted again), then point the app's variables at the new project. People sign in again (sessions are not backed up). Expected effort: about 30 minutes. Data lost: everything after the last backup, **except** that learners keep their progress on their own devices (local-first) and can re-save it, and anyone who deleted their account in the gap should be deleted again from your request log.
* **Tested:** the backup file's encryption, tamper checks and refusal rules (unit); the full export → empty → restore → identical rows round trip on a real database, and the command-line tools (database suite, CI).

## Performance note (not a blocker)
Lessons are local and unaffected by distance. The account pages talk to Singapore: from a Vercel function in a US/EU region each account page takes a few round trips (about a second). That is acceptable for five students. After launch, measure and, if wanted, set the function region to `sin1` (one small PR, prepared tool).

## Launch blockers (only these)
1. Step 1 dashboard settings (Email provider off, redirect URL, sign-ups on).
2. The nine migrations applied and the post-migration security check clean.
3. Google OAuth client configured in Supabase (Testing mode is fine).
4. Production environment variables set and the `env` readiness check PASS.
5. `grammigo.si` serving HTTPS (or, if you prefer to start on `grammigo.vercel.app`, set `AUTH_SITE_URL` and the Google/Supabase redirect to that address instead; the domain is **not** a blocker in itself, only the **canonical address you give students** must match `AUTH_SITE_URL`, the Supabase redirect list and the Google client).
6. Step 7 acceptance, including one real iPhone Safari pass, and a first backup.
7. **Privacy notice: operator legal name, contact address and privacy email filled in by you** (the notice is a draft and says so; I will not claim legal approval). Whether a lawyer must review before adults other than people you know personally use it is **your decision**; the draft states plainly that it has not been reviewed.

## Not blockers (after launch)
Supabase Pro; Postgres upgrade if none is offered; `sin1` region; redirecting the old address and the transfer banner; Google brand verification; a physical-device second pass; re-consent flow; lawyer review (see 7); independent security review; point-in-time recovery.

## Exactly what I need you to authorize next, in order
1. **Merge** the remaining PRs when green (I will do it; this is already authorized).
2. **Step 1** at the Supabase dashboard (you), and tell me the Infrastructure upgrade yes/no.
3. **"Apply the eight migrations plus the helper fix"** (the first production write).
4. **Step 3** Google client (you), **Step 4** Vercel variables (you).
5. **"Add grammigo.si to Vercel; I will change DNS"**, then your DNS change.
6. **Step 7** acceptance run, then **"enable accounts"**, then invitations.
