# Operator checklist: what I need from you to verify the remaining production facts

**Rule for every item: never paste an API key, a service-role key, a database password, a Google client secret, a JWT or a connection string into chat, a ticket or a screenshot.** Everything below can be shown as a name, a setting, a yes/no, or a screenshot with the secret field not in view. If a secret is ever exposed by accident, say so and rotate it straight away (order in `google-oauth-and-config.md` §4); that is routine, not a problem.

Three safe ways to give me a fact, in order of preference:
1. **Connector (read-only).** For Supabase I can read facts myself through the connector you installed (already used once; see `production-inspection-2026-11-01.md`). It exposes no keys to me, and I only call read-only tools.
2. **Run a script on your machine and paste its output.** `scripts/check-production-readiness.mjs` is read-only and prints only check names, PASS/FAIL and fixed words; it redacts every secret value it was given, even by accident. You type or load your values into *your own terminal*; they never come to me.
3. **Screenshot or short text of a dashboard page**, with the described fields only.

## A. Supabase: organisation, plan, region, backups
| Fact | Status | What I need from you |
|---|---|---|
| Project identity, region, organisation, Postgres version, empty schema, no users | **Verified 2026-11-01** (read-only connector) | nothing |
| **Plan** | Free today. Must be **Pro** before real data | Tell me when you have upgraded the organisation `grammigo` to Pro (Dashboard → Organization → Billing). I will re-read the plan through the connector to confirm |
| **Backups** (daily backups listed, retention, last backup time) | **Not visible to me through the connector** | After the upgrade: a screenshot of **Database → Backups**, showing the list of backups and the retention note. Nothing secret is on that page |
| Postgres build in the `withdrawn` channel | Open | A screenshot of **Settings → Infrastructure** showing whether an upgrade is offered, and, if it is, your go-ahead to apply it while the database is empty (a separate approval; I will not do it) |
| Auth settings (providers, signups, linking, site URL, redirect list, JWT expiry) | Not readable by me | Either screenshots of **Authentication → Providers**, **→ URL Configuration**, **→ Sessions/JWT**, with the Google client secret field not in view, **or** run `node scripts/check-production-readiness.mjs auth --expect-google off` in your terminal with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set (the anon key is a public key, but keep it out of chat anyway) and paste the output |
| Migration state and RLS/grants once migrations are applied (later, after approval) | n/a yet | Run `node scripts/check-production-readiness.mjs db` with `SUPABASE_DB_URL` set in your terminal; paste the output. Use a **read-only** database role if you can create one; the script also forces a read-only transaction |

## B. Vercel: production environment and function region
The Vercel connection in this session is not authorised for your team. Either:
* **Authorise it** (I will generate the approval link with the Vercel connector's `authorize_team_access` and you open it; it asks you to approve; no key changes hands), after which I can read project settings, domains and the **names** of environment variables; or
* give me, as text or screenshots of **Project → Settings**: (1) plan (Hobby/Pro), (2) **Functions → Function Region** (current value), (3) **Domains** list and whether `grammigo.si` is attached, (4) **Environment Variables**: the **names** and which environments (Production / Preview / Development) each is set for, **with values hidden** (Vercel hides sensitive values by default; do not click "reveal").
* Optional and better: in your own terminal run `vercel env pull .env.check` (this puts real values in a local file), then `node scripts/check-production-readiness.mjs env --env-file .env.check`, paste the output, and **delete `.env.check`**. The script prints no value.
What I will check: no Supabase/auth secret exists for Preview or Development; `NEXT_PUBLIC_ACCOUNTS` is unset or not `on` everywhere until you approve the switch-on; no existing variable has a `NEXT_PUBLIC_` prefix and a secret-looking name.
Function region: Supabase is verified in Singapore, so `sin1` is the candidate. The tool `scripts/vercel-region.mjs --supabase-region ap-southeast-1` prepares the file; I will only propose merging it after the latency measurement, and merging it changes how production is deployed, so it needs your approval.

## C. Google OAuth configuration
Nothing exists yet, so there is nothing to verify; you create it, then show me the settings (never the secret).
| Fact | Show me |
|---|---|
| Which Google account/organisation owns the Cloud project | its name, and whether a second owner exists |
| OAuth consent screen: user type, app name, support/developer contact, authorised domains, scopes, publishing status (Testing / In production) | a screenshot of **Google Auth Platform → Branding / Audience / Data Access** |
| Client: type, **authorised redirect URIs**, authorised JavaScript origins | a screenshot of the client's settings page with **the Client secret not in view** (the Client ID is public and may be shown). Expected: one redirect URI, exactly `https://ugifdvaaaioiqmwfiksw.supabase.co/auth/v1/callback`, and **no** JavaScript origins |
| Test users (while in Testing) | the count and that they are your disposable accounts |
| That the client ID/secret were entered in Supabase | only "done"; I can then check `external.google` is true with the `auth` readiness check |
Do **not** enter the Google credentials in Supabase until the migration and approval steps in `migration-plan.md` say so.

## D. Privacy notice: operator and contact details
Grammigo is run by **you as an individual, not a company** (recorded). I will not invent a legal name, address or entity. Please confirm, in your own words, each of the following (or tell me it should stay blank until counsel decides):
1. The **legal name** you want shown as the operator (or "leave to counsel").
2. A **contact address** you are willing to publish (postal or a PO box/agent address), or "leave to counsel".
3. The **privacy email address** to publish. It needs a mailbox that actually exists on `grammigo.si` (the domain has no mail records yet): which provider will host it?
4. Your **country/jurisdiction** of residence, and the countries where learners are expected (this decides which disclosures apply; counsel completes them).
5. A **deputy**: someone who can act on a deletion/export request or flip the kill switch if you cannot (name and how to reach them; nothing secret).
6. Whether AI features (OpenAI) are **on or off** in production today.
I will put the answers in the notice as bracket-free text only for items you confirm; everything else stays bracketed and the notice stays a DRAFT until a lawyer has reviewed it.
