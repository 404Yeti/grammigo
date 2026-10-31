# CI and branch protection

## What runs (`.github/workflows`)
| Check (required on `main`) | What it proves |
|---|---|
| **Quality** | `next typegen` + `tsc --noEmit` (a clean checkout has no generated `PageProps`/`LayoutProps` types until typegen runs; locally use `npm run typecheck`), ESLint, the whole Vitest suite |
| **Browser tests** | production build with the Guided Correction preview flags, then Playwright on Chromium (mobile and desktop), one retry allowed and reported |
| **Dependency audit** | `npm audit --audit-level=high` (moderate findings in dev-only linters are tracked, not blocking) |
| **Secret scan** | gitleaks over the full history |
| **CodeQL analysis** | JavaScript/TypeScript, `security-extended` queries (also weekly) |
| **Database isolation** | Starts the local Supabase stack on the runner and runs `npm run test:db` (catalogue, cross-account isolation, invitations, documents, deletion, REST API). It fails if the stack does not start or any check fails |

Jobs have read-only repository permissions and no production secrets: no AI key, no Supabase key, no Google credentials. Third-party actions are pinned to commit SHAs. Dependabot proposes weekly updates for npm packages and Actions.

## Protection on `main`
* a pull request is required (no direct pushes), 0 required approvals (one-person team), stale approvals dismissed;
* the five checks above must pass and the branch must be up to date with `main`;
* linear history (squash or rebase merges), conversations resolved;
* force pushes and branch deletion are blocked;
* applied to administrators too.

**Relaxing it deliberately** (for example if GitHub Actions is down): *Settings → Branches → main → edit*, or `gh api -X DELETE repos/404Yeti/grammigo/branches/main/protection/enforce_admins`, then restore afterwards. Do not leave it relaxed.

## Rules of the road
Account features default **off** behind `NEXT_PUBLIC_ACCOUNTS`; privileged keys never appear in client code, logs or the repo; mastery, profile and recommendation code is not changed by account work.
