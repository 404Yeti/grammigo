# Production smoke test, performance acceptance and real-iPhone run (plan; nothing here has been run on production)

## Rules for any run on production
* Only **disposable test identities**: 3 Google accounts the owner controls and can delete (call them T1, T2, T3), plus the owner's own account for the owner screens. No real student, no real student email.
* No load, no fuzzing, no destructive step except **the test accounts deleting themselves through the app** (which is itself part of the test).
* Keys: the anon key may be used for the read-only probes; the service-role key is **never** used in the smoke test. Nothing is pasted into a ticket.
* Two people available; the owner can switch `NEXT_PUBLIC_ACCOUNTS` off and redeploy (the kill switch) within minutes. Practise the kill switch first.
* Results go in a dated run-sheet (counts and pass/fail, no personal data) attached to the Linear issue.

## Sequence (each step: expected result; stop on any surprise)
**A. Before accounts are enabled (after migrations only)**
1. Schema probes from `migration-plan.md` (privilege check, anon REST refused). 
2. Auth settings probe (`/auth/v1/settings`).
3. Production site unchanged: anonymous lessons + Guided load, account routes 404.

**B. Enable accounts (owner approval) and check the front door**
4. `/signin` and `/join` render; no sign-in link shown to guests except the plain header link; `/account` redirects to sign-in.
5. T1 (uninvited) signs in with Google → "No account yet"; check afterwards that T1 left **no** profile and (after the nightly sweep or a manual cleanup call) no identity.
6. Owner creates an invitation (1 seat, 1 day) in the app. Only the code's last 4 characters show in the list afterwards.
7. T1 joins with the code, ticks 18+ → dashboard. Reusing the code with T2 → "no places left". An expired/revoked code → the right message. T2 cannot join by guessing a near-miss code (rate limit visible after repeated tries; do not exceed a handful).
8. T1 profile edit persists; T2 (second invitation) joins; T1 cannot see T2 anywhere (API: `GET /api/account/me` only returns self).

**C. Learning and sync (T1 on laptop, T1 on iPhone, T2 separately)**
9. Complete a lesson as a guest, sign in, see the import preview, decline, then accept: guest copy unchanged.
10. Turn saving on: consent recorded; finish a lesson; status reads "Saved to your account" only after the save; the account page shows it on the second device.
11. Airplane mode mid-lesson, finish, reconnect: saves by itself.
12. T1 and T2 on the same browser alternately: no progress crosses.
13. Guided Correction session: works, stays separate from mastery.

**D. Data rights**
14. T1 downloads their data: only T1's records. T2's export contains nothing of T1's.
15. T2 deletes their account (sign-in ≤ 10 min, or the "sign in again" step): signed out everywhere, old cookies dead, goodbye page. Re-using T2's Google account to sign in lands on "No account yet".
16. Owner confirms (dashboard, read-only) counts: T2's profile/consents/documents gone; ledger has one entry; audit shows `account_deleted` with no actor.
17. T1 deleted at the end of the run.

**E. Resilience (on a Preview deployment pointed at an unreachable Supabase URL, not by touching production)**
18. Full lesson + Guided Correction session complete; account routes answer "try later"; no sign-in prompt appears; lessons time within criteria below.

**F. Cleanup:** all test accounts deleted; no test invitation left valid; run-sheet filed; kill switch rehearsed again.

## Performance acceptance criteria (measurable; measured on production over its real network path in 7C, from Europe and, if the region is not Europe, also from the project's region)
| ID | Criterion | Basis |
|---|---|---|
| P1 | **0** requests to Supabase or any account/sync route while answering a question, receiving feedback, or advancing a Guided step. 1 status check per page load, ≤ 1 save per finished lesson or Guided session | enforced today by tests (`e2e-accounts/sync.spec.ts`, architecture tests); re-measured on production from the browser's network log |
| P2 | Answer feedback visible ≤ 250 ms p95 and ≤ 500 ms max even when the sync network never answers | measured in CI: max 235–366 ms with a hung network |
| P3 | With Supabase unreachable (preview pointed at a dead URL): a whole 8-question lesson and a Guided session complete with no error, in ≤ 1.5× the normal time; account pages answer 503/"try later" within **≤ 10 s** (see risk R3) and never "sign in again" | CI: lesson ~1.2–2.3 s against a refusing server |
| P4 | Save (PUT) p95 ≤ 800 ms and state check p95 ≤ 600 ms, browser-to-response, on 4G from the learner's region; server database time p95 ≤ 150 ms (from the `Server-Timing` header) | CI against a local database: save 12/16 ms p50/p95, whole stack 19–23/25–39 ms. Production adds WAN latency, which is exactly what 7C measures |
| P5 | `/account` first response ≤ 1.5 s p95; largest contentful paint ≤ 2.5 s on a mid-range phone over 4G | depends on region (R2) |
| P6 | Sign-in tap to dashboard ≤ 8 s p75 on 4G (dominated by Google) | to measure |
| P7 | Document size p95 ≤ 100 KB; none over the 900 KB ceiling in the pilot | to measure from row sizes |
| P8 | Database stays well inside the plan: size < 1 GB, MAU < 100, egress < 5 GB/month for 200 learners | arithmetic: ≤ 2 documents of ≤ 900 KB per learner is ≤ 360 MB worst case |
| P9 | Zero unhandled errors on the learner path in a 20-minute scripted session on each browser | Playwright + manual |
| P10 | Rate-limit rows and audit rows stay small (pruned by the nightly job) | row counts after a week |
Pass = every criterion met on two consecutive runs. A miss blocks inviting students and becomes a Linear issue.

## Real-iPhone Safari acceptance
The full checklist is `docs/dev/real-device-acceptance.md` (sections A to E cover Google sign-in and join, lessons, Guided Correction, offline, progress synchronisation across two devices, account switching, export, the device copy, deletion with the sign-in-again step, accessibility). For production, run it **after step 17 above, on the real `.si` domain, with the test identities**, on at least one current iOS and, if available, one older iOS, in Safari (not an in-app browser) and once from a link opened from Messages. Additional items for that run: Private Browsing behaviour, Low Power Mode, a Safari content blocker enabled, and "Prevent Cross-Site Tracking" on (default). Record device, iOS version, commit, tester. **Not claimed until a person has done it.**
