# Phase 7A readiness report: production readiness and configuration planning

Date: 2026-11-01. Scope: **planning only.** Nothing was applied, configured, enabled, redirected or invited. Production Supabase `ugifdvaaaioiqmwfiksw` was not modified, and no credential was used or seen. Only public, unauthenticated reads were made (a request to its public endpoint, DNS lookups of the domains).

## 1. What was inspected, and what could not be
| Item | Result |
|---|---|
| Supabase project exists | **Yes.** The public endpoint answers with the platform's JSON "No API key found" for `/rest/v1/` and `/auth/v1/health`. It sits behind Cloudflare. |
| Region | **Not determinable from outside** (Cloudflare anycast hides it). The migration comment and design assume ap-southeast-1 (Singapore). **Unverified.** |
| Organisation, plan, Postgres version, current schema, backups | **Not inspectable without credentials.** I did not ask for or use any. A read-only way to get them is in §8. |
| Vercel project, domains, environment variables | **Not inspectable:** the Vercel connection in this session is not authorised for the team, and I did not widen it. |
| Domain `grammigo.si` | Registered and resolving, but its `A` records are two AWS addresses (`34.216.117.25`, `54.149.79.189`), **not Vercel**; no `www`; HTTPS times out. Looks like registrar parking. |
| Production app (today) | Healthy; accounts disabled; account/sync routes 404 (POST) as verified after the Phase 6 merge. |
| Credentials in the repo or client bundles | None found: no `.env*` tracked except `.env.example`; built client bundles contain no service-role/pepper/secret names, no JWT-shaped strings, no `supabase.co` host. The project ref appears only in docs. |

## 2. Deliverables (all in `docs/ops/`)
1. Inspection: this section and §8 (what the owner must provide).
2. Migration plan with pre-flight, order, checks, rollback and recovery: `migration-plan.md`.
3. Google OAuth instructions, exact URLs, Supabase auth checklist, environment variables, Vercel configuration, secret handling: `google-oauth-and-config.md`.
4. Credentials stay server-side: §4 of that file (verified now; re-verified on the production artefact in 7B).
5. Domain migration and guest-progress transfer plan: `domain-and-guest-transfer-plan.md`.
6. The 15 skipped unit tests: §4 below.
7. Production smoke-test sequence with disposable identities: `smoke-test-and-acceptance.md`.
8. Real-iPhone Safari checklist: `docs/dev/real-device-acceptance.md` plus the production-run additions in `smoke-test-and-acceptance.md`.
9. Privacy notice placeholders and legal decisions: `privacy-placeholders.md` (the notice is unchanged and still a draft; I could not honestly fill any placeholder that needs facts I cannot verify).
10. Backup-restore drill feasibility and method: `restore-drill-plan.md`.
11. Performance acceptance criteria, incl. learning with Supabase down: `smoke-test-and-acceptance.md` (P1 to P10).
12. Scope of Supabase: unchanged and enforced (§7).

## 3. Findings that change the plan
* **F1. Region and latency (decision needed).** If the project is in Singapore, a learner in Europe pays roughly 250 to 300 ms per round trip to it (estimate). The account pages make several sequential calls (verify session, read profile, check owner flag), so if the Vercel functions run in a US or EU region they would add about a second or more to each account page. Learning itself is unaffected (it never calls Supabase). Mitigations: pin the function region next to the database (`regions: ["sin1"]` in `vercel.json`, one extra hop for the browser instead of several), reduce sequential calls, or accept it for a pilot. The project's region cannot be changed after creation; a different region would mean a new project (the "permanent" project decision is the owner's). **Measure first (7C), then decide.**
* **F2. A hung Supabase can hang account pages (small code fix proposed).** The server-side Supabase clients have no request timeout. When Supabase *refuses* connections the app answers 503 quickly (tested). If it *hangs* (accepts and never answers) a server-rendered account page or API call would wait until the platform's function limit. Lessons are unaffected either way, and the browser's sync already gives up after 10 s. Proposal: a hard timeout (about 8 s) on both clients and a test against a black-hole address. 7B change, small and testable.
* **F3. `NEXT_PUBLIC_ACCOUNTS` is fixed at build time.** Turning accounts on or off (the kill switch) needs a redeploy. Practise it before launch; expect minutes, not seconds.
* **F4. Guests are stranded by a naive redirect** (origin-scoped storage). A transfer is required before redirecting (see the domain plan). Accounts avoid the issue because they will exist only on `.si`.
* **F5. `grammigo.si` DNS must change** from the parked AWS records to Vercel, at the registrar, with a short TTL first.
* **F6. Google brand verification takes time**; plan days. Non-sensitive scopes avoid the security assessment.
* **F7. Vercel Preview must never receive production secrets** (scope every variable to Production).

## 4. The 15 skipped unit tests
They are all intentional, environment-gated tests, in four places:
| Where | Count | Why skipped | Release-relevant? | Gap and action |
|---|---|---|---|---|
| `src/lib/ai/upstash.live.test.ts` | 8 | Needs a real Upstash Redis (credentials) | Only if **AI features are on in production**: Upstash is the durable AI rate limiter and budget cap (required before enabling AI) | Run once against a scratch Upstash database before AI is enabled in production; record the result. Not needed for accounts |
| `src/features/guided/ai/check.live.test.ts` | 5 | Calls the real OpenAI API | Only if Guided second opinions are enabled in production | Run `scripts/ai-live-check.mjs` / the live test with a dev key before enabling; note the deprecated-model issue (FAI-21) |
| `src/features/guided/ai/check.corpus.live.test.ts` | 1 | Real OpenAI over the labelled corpus (cost, needs `GUIDED_LIVE_CORPUS=1`) | Same as above; it measures quality, not safety | Run once per model change |
| `src/features/guided/review-export.test.ts` | 1 | A developer tool that regenerates review files (`GUIDED_REVIEW_EXPORT=1`) | No | None |
None of the 15 covers accounts, sync, deletion or export. **Release-relevant gaps are elsewhere and are not skips:** real Google sign-in and consent, the real hosted Supabase (RLS and auth settings as configured there), the provider's own backup restore, physical iPhone Safari, real production latency, and a black-hole (hung, not refused) Supabase (F2). Each has an item in the plans above.

## 5. Risks
| ID | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | The project's plan, region, schema or backups differ from the assumptions | medium / high | Pre-flight checks (migration plan); do not proceed on any mismatch |
| R2 | Latency to a far region degrades account pages | medium / medium | F1; measure; pin function region |
| R3 | Hung Supabase hangs account routes | low / medium | F2 fix + test |
| R4 | Google re-sign-in is weaker than it reads | medium / medium | Wording already honest; verify on real Google; security-review §7a |
| R5 | A mis-set dashboard auth option (email provider on, linking on, wide redirect allow-list) | medium / high | Checklist + scripted read of `/auth/v1/settings` blocks enabling accounts |
| R6 | A secret leaks (repo, preview, logs, screenshot) | low / high | Section 4 of the config plan; rotation order documented; Production-only scoping |
| R7 | Guest progress lost by the domain move | high if done naively / medium | Transfer before redirect |
| R8 | Backup/restore never proven on the real provider | medium / high | Restore drill (scratch projects) before the first student |
| R9 | Single person (owner) is the only operator, for suspended-learner requests, restores and the kill switch | high / medium | Name a deputy; two owners on Google Cloud, Supabase, Vercel |
| R10 | Legal review not done; notice has open placeholders | high / high | Hard gate: no real student until done |
| R11 | `grammigo.si` DNS mistakes | low / medium | TTL 300 s first; rollback = restore old records |
| R12 | Preview deployments pointed at production data | low / high | Production-only variable scope; accounts off on Preview |

## 6. Exact changes proposed for Phase 7B (nothing below is done; each group needs your explicit approval)
**Code/repo (reviewed PR, CI green, no production effect):**
1. Server-side Supabase request timeouts (about 8 s) on both clients, with a hung-host test (F2).
2. `vercel.json` with the nightly cleanup cron (and `regions` only if measurement supports it).
3. A read-only script `scripts/check-production-auth.mjs` that reads `/auth/v1/settings` with the anon key and fails on any unexpected provider or setting.
4. The guest-progress transfer (option B with the file fallback) with tests, **on a preview**.
5. Canonical/`metadataBase` for `grammigo.si` (shipped only at redirect time).

**Supabase production (on your explicit go-ahead, at the gate in the migration plan):**
6. Record region/plan/version (pre-flight). 7. Apply the 8 migrations in order with the checks. 8. Dashboard auth settings per the checklist. 9. Google provider id/secret entered by you in the dashboard.

**Google Cloud (you):** consent screen, OAuth client with the single Supabase callback URI, test users.

**Vercel (you or me, with approval):** the production-only environment variables in §3 of the config plan; domain attached without redirect; `www` redirect.

**DNS (you, at the registrar):** TTL then the Vercel records for `grammigo.si`.

**Enabling accounts:** set `NEXT_PUBLIC_ACCOUNTS=on` on Production and redeploy; run the smoke test with disposable identities; practise the kill switch.

**Not before:** the legal review gate, the restore drill, the real-iPhone acceptance and the performance criteria all being met (Phase 7C), and no real student before that.

## 7. Scope of Supabase (unchanged, enforced)
Supabase holds only identity, accounts, profiles, invitations, consents and asynchronous, batched, consent-gated durable progress. Architecture tests fail the build if lesson, mastery, Guided or storage code imports account code or makes a network call, if a sync call is triggered per answer, or if an AI route knows about accounts. Production measurements in 7C re-check P1 (zero Supabase requests while answering).

## 8. What I need from you to finish the inspection (read-only; nothing is changed by any of these)
* **Supabase:** the quickest way is for you to run `! npx supabase@2.122.0 login` in this session (the token stays in your local Supabase config, outside the repo); I would then run only read-only commands (`projects list` for region/organisation, `backups list`, `migration list`) against the project. Or paste the dashboard values: organisation, plan, region, Postgres version, whether the `public` schema is empty, Backups page contents.
* **Vercel:** authorise the team for this session, or tell me: the project's plan, function region, whether `grammigo.si` is already attached, and the names (not values) of the existing environment variables.
* **Owner facts** for the notice: operator name/address, privacy mailbox, who the deputy is.

## 9. Estimated costs (USD; vendor prices checked today where stated, otherwise marked as estimates; verify at purchase)
| Item | Monthly | One-off / note |
|---|---|---|
| Supabase Pro (the production organisation) | **$25** (includes $10 compute credit = one Micro instance, 8 GB disk, 100k MAU, 250 GB egress) | checked on the pricing page today. Needed for daily backups (7 days) |
| Larger production compute (only if latency/load needs it) | Small about +$5 over the credit (estimate) | not expected for a pilot |
| Point-in-time recovery | $100 (7 days) | **not recommended for the pilot** |
| Restore-drill scratch projects | $0 (free tier, Track 1) to about $25 prorated for a day or two (Track 2) | cancel the same day |
| Vercel | Hobby $0 or Pro $20 per seat (plan unverified) | a daily cron works on Hobby; Pro if you want more regions/limits |
| Domain `grammigo.si` | renewal at the registrar (not checked) | already registered |
| Google Cloud / OAuth | $0 | |
| Email mailbox for the privacy contact | $0 to about $6 per user (depends on provider) | |
| Legal review of the notice and processes | unknown | a hard gate; get quotes |
| OpenAI / Upstash | unchanged by accounts | only if AI is on |
**Expected recurring: about $25 to $45 per month** (Supabase Pro, optional Vercel Pro, mailbox).

## 10. Stop point
This is a plan, not an execution. **Phase 7B does not begin without your explicit approval**, and each production-touching group in §6 will ask for its own go-ahead at the moment it is run.
