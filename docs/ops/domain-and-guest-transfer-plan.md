# Moving to grammigo.si, and what happens to guests' progress (plan only; no DNS or redirect has been changed)

## What I found (read-only)
* `grammigo.vercel.app` serves the app today.
* `grammigo.si` already has **A records pointing at two AWS addresses** (`34.216.117.25`, `54.149.79.189`), not at Vercel, no `www` record, and HTTPS to it **times out**. That looks like a registrar parking/placeholder setup. Whether the domain is attached to the Vercel project could not be checked: the Vercel connection in this session is not authorised for the team (`robert-leybas-projects`) and I did not widen that access. The owner can read both facts in Vercel → Project → Domains.

## The problem the redirect creates: guest progress lives in the browser's origin
Anonymous progress is in `localStorage`, which the browser keys by **origin**. `https://grammigo.si` and `https://grammigo.vercel.app` are different origins, so a guest redirected from one to the other **appears to lose all progress** (it is still on the old origin, unreachable from the new one). Accounts are not affected (none exist in production, and accounts will only ever run on `.si`). So: **do not redirect guests until a transfer exists.**

## Options for carrying guest progress across
| Option | How | Pros | Cons |
|---|---|---|---|
| A. File hand-off | Old site: "Move my progress" downloads the existing device-copy JSON. New site: "Add progress from a file" validates it (existing parsers) and merges with the existing lossless union, after a preview | no cross-origin code; works offline; learner in control | clunky on iPhone (Files app); two steps |
| **B. One-tap bridge (recommended)** | New site opens `https://grammigo.vercel.app/transfer` in a window the learner opened by tapping. After a second tap on the old page ("Send my progress to grammigo.si") it posts the data **only to the exact origin `https://grammigo.si`**. The new site checks the sender's origin, validates the schema, shows the preview ("what is new"), and imports only on confirmation | one-tap for the learner; same preview + consent as the existing guest import | needs careful origin checks both ways (small, testable surface); pop-up must come from a user gesture (fine on iOS) |
| C. Do nothing, keep both | `.vercel.app` stays as is for existing guests; new people use `.si` | zero code | guests split across two origins forever; confusing |

Recommendation: **B, with A as the fallback** (same validator behind both). Neither changes lesson, mastery or Guided code: both reuse `parseStoredState`, `adoptLessons`, `adoptGuided` and the preview already built for guest import. The tests: a malicious page posting to the new site is ignored (origin + schema + size), the old site never sends to any other origin, nothing is written without the confirm tap, and the old data is never deleted.

## Order of operations (each step needs approval; steps 1 to 3 change nothing for current users)
1. **Registrar (Spaceship) DNS:** lower the TTL of `grammigo.si` records to 300 s a day beforehand. Replace the two AWS `A` records with the values Vercel shows for the project (usually `A 76.76.21.21`, or the project-specific records now shown in Vercel); `www` → CNAME as Vercel instructs. Keep any MX/TXT records (none seen).
2. **Vercel:** add `grammigo.si` as a production domain with **no redirect** from `.vercel.app` yet; add `www` → 308 to apex. Certificates issue automatically. Confirm `https://grammigo.si/` serves the same app (accounts still off).
3. **Search/canonical:** set `metadataBase`/canonical to `https://grammigo.si` only when step 6 starts, so crawlers do not split ranking early.
4. **Build and test the transfer (B/A)** on a preview; test on a real iPhone.
5. **Enable accounts on `.si` only** (7B/7C).
6. **Banner on `.vercel.app`:** "Grammigo has moved to grammigo.si. Move your progress" for N weeks (suggest 6).
7. **Redirect:** 308 `grammigo.vercel.app/*` → `grammigo.si/*` **except `/transfer`**, which stays on the old origin for at least 3 months more (a guest returning late must still be able to bring their progress).
8. Remove the carve-out only when analytics-free evidence says nobody needs it: there are no analytics, so choose a fixed date and announce it.

## Rollback
DNS: restore the previous records (TTL 300 s makes this minutes). Vercel: remove the domain. Redirect: remove the redirect rule. No data is changed by any of it; guests' progress is never deleted by the move.

## Things that must be true on `.si` before accounts are enabled
`AUTH_SITE_URL=https://grammigo.si`; Supabase Site URL and redirect allow-list = `.si` only; Google redirect URI = the Supabase callback (the app's own domain is not a Google redirect URI, so DNS timing does not affect Google); cookies are `__Host-` prefixed (host-only), so nothing is shared with `.vercel.app`; HSTS added after a week of stable HTTPS.
