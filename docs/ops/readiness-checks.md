# Read-only production readiness checks (prepared in Phase 7B; run only when you choose to)

`scripts/check-production-readiness.mjs` answers "is production configured the way the plan says?" without being able to change it.

| Command | Reads | Needs (in YOUR terminal's environment) |
|---|---|---|
| `… env [--vars-file f] [--ref ugifdvaaaioiqmwfiksw]` | variable **presence and shape** only: present, long enough, different where they must differ, HTTPS canonical domain, the right project, no secret-looking `NEXT_PUBLIC_` name | the variables themselves (or an env file: **only this check reads one**, because it sends nothing; the checks that make requests use your terminal's environment only) |
| `… auth [--expect-google on\|off]` | `GET /auth/v1/settings` with the **public anon key**: Google on/off as expected, no other provider (email, phone, others), sign-ups allowed, anonymous sign-ins off if reported | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `… rest` | the Data API as an anonymous caller: no table returns rows, nothing is listed in the API description | same |
| `… db` | `SELECT`s in a read-only transaction: applied migrations equal the repository's, tables and RLS, anon has no privilege, learners hold only their three `SELECT`s and four updatable profile columns, no unexpected function is executable | `SUPABASE_DB_URL` |
| `… all` | all of the above | all of the above |

Safety properties (all tested): the database check runs only `SELECT`s (a test asserts every statement) inside `begin read only` with `default_transaction_read_only=on`; the HTTP checks are `GET`s; **no value of any variable is ever printed** (results are names, PASS/FAIL, fixed words, passed through a redactor that also strips JWT-shaped strings and connection strings); the exit code is 0 only if every check passes. On the local stack the `db` and `rest` checks run in CI (`supabase/tests/ops/readiness.test.ts`) and must pass, and a deliberately wrong grant must make them fail.

What it cannot see read-only (listed in its output as notes): Site URL, the redirect allow-list, JWT expiry, rotation settings; whether Preview/Development are separated from Production in Vercel; backups. Those come from the operator checklist.

Before migrations are applied the `db` check is expected to say NOT READY (no tables yet); the `auth` check with `--expect-google off` is the right pre-OAuth state.

## Function region
`node scripts/vercel-region.mjs --supabase-region ap-southeast-1 [--with-cron]` prints the `vercel.json` to review. It accepts only a Supabase region from its table, never guesses, refuses to overwrite an existing `vercel.json`, and deploys nothing. Verified region today: `ap-southeast-1` → `sin1`.

## Request timeouts
Every server-side call to Supabase gives up after `AUTH_REQUEST_TIMEOUT_MS` (default 8000, kept between 1000 and 15000). A Supabase that refuses connections **or accepts them and never answers** now ends in 503 "try later" within that time and never "sign in again". Lessons and Guided Correction make no such call and are unaffected. Tested with real hung sockets (`src/lib/auth/hung.test.ts`) and in a browser against a black hole (`e2e-accounts/hung-supabase.spec.ts`).

## Guest transfer (off by default)
`NEXT_PUBLIC_GUEST_TRANSFER=on` (build time) enables `/transfer/receive` (new address) and `/transfer/send` (old address); `NEXT_PUBLIC_TRANSFER_SOURCE_ORIGIN` / `…_TARGET_ORIGIN` name the two addresses (defaults `https://grammigo.vercel.app` / `https://grammigo.si`). While off both pages are 404. Protocol, limits and tests: see `domain-and-guest-transfer-plan.md` (option B with the file fallback). Nothing is linked from the app yet; the banner comes at the redirect step of that plan.
