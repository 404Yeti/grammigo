# Local development prerequisites (accounts work, Phase 2 onward)

Nothing here creates a cloud resource. The local Supabase stack runs entirely in Docker on your machine and is thrown away with `supabase stop`.

## State of this machine (checked 31 Oct 2026)
* Docker Desktop **is installed** (`C:\Program Files\Docker`), but it is **not running** and **WSL integration is not enabled** for the `Ubuntu` distro, so `docker` is not available inside WSL.
* Node 22 is installed. The Supabase CLI is **not** a dependency: run it pinned with `npx --yes supabase@2.122.0 …`.

## One-time Docker setup (you do this; ~5 minutes)
1. Start **Docker Desktop** on Windows and wait until it says the engine is running.
2. **Settings → General:** tick *Use the WSL 2 based engine*.
3. **Settings → Resources → WSL integration:** turn on *Enable integration with my default WSL distro* and switch **Ubuntu** on. Click *Apply & restart*.
4. Open a new Ubuntu terminal and check: `docker version` (both Client and Server must print) and `docker run --rm hello-world`.
5. Memory: the stack plus the app's tests like ~6 GB free. If Docker is slow, add `[wsl2] memory=8GB` to `%UserProfile%\.wslconfig`, then `wsl --shutdown`.

## Using the local stack (from Phase 2)
```bash
npx --yes supabase@2.122.0 start      # first run pulls images (a few GB); prints local API URL and keys (local-only keys)
npx --yes supabase@2.122.0 db reset   # applies supabase/migrations/* from scratch
npm run test:db                       # the cross-account isolation suite (added in Phase 2)
npx --yes supabase@2.122.0 stop
```
The local keys printed by `supabase start` are demo keys valid only against your own containers. They are **not** secrets, but they still never go into the repository or any `NEXT_PUBLIC_` variable.

## If you prefer not to install Docker
Isolation tests can run **only in CI** (GitHub's runners have Docker). Development is slower (push to see results) but nothing else changes.

## Environment variables (names only; values never in the repo)
| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ACCOUNTS` | build | Account features on/off (default **off**) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build | Public client values (safe in the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Privileged key; one server module; never `NEXT_PUBLIC_` |
| `INVITE_HMAC_PEPPER`, `INVITE_GRANT_SECRET` | **server only** | Hash invitation codes; sign invitation grants |
| `OWNER_EMAIL` | **server only** | Owner/admin identity (you provide this securely; I will never ask for it in chat) |
| `CRON_SECRET` | **server only** | Protects the cleanup route |

## Accounts tests (Phase 3)

With the local Supabase stack running (`npx --yes supabase@2.122.0 start`):

```bash
npm run test:db            # database + account-flow integration tests (real Auth, real RLS)
npm run test:e2e:accounts  # builds with NEXT_PUBLIC_ACCOUNTS=on into .next-accounts, then runs the accounts browser tests
```

Both FAIL (they never skip) when the stack is not running. CI runs both on every pull request. The accounts build uses its own folder
(`.next-accounts`, via `NEXT_DIST_DIR`) so it never overwrites the normal build. See `docs/dev/auth.md`.
