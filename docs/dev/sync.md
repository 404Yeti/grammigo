# Local-first progress sync and guest import (v0.4 Phase 5)

Status: implemented and tested locally and in CI. **Not provisioned and not deployed.** Accounts (and so all of this) are off unless
`NEXT_PUBLIC_ACCOUNTS=on`. With them off, none of it is reachable: every sync route answers 404 and no sync code runs. The production Supabase project
(`ugifdvaaaioiqmwfiksw`) has not been touched; everything here ran on the local stack and in CI.

## The model in one paragraph

Grammigo is local-first. A learner's progress is saved in this browser, exactly as it always has been, and **that is the source of truth for learning**.
Signing in adds a *copy* in the learner's account, kept up to date in the background so progress follows them between devices. Lessons never wait for the
copy, never fail because of it, and never call the network.

## What is saved, and what is not

Two documents per account, the same versioned JSON the app already keeps on the device:

| Document | Contents | Never contains |
|---|---|---|
| `lessons_v2` | lesson sessions (answers, attempts, hints), quick-check runs and answers, goals text, onboarding state, AI writing feedback | mastery, profile, recommendations (all **derived** on read, by the same deterministic code) |
| `guided_v1` | Guided Correction sessions (the text typed or confirmed; never audio) | any weight, score or level: it is stored as the activity it is, and is kept in its **own** document |

## How a save happens (and why it cannot slow learning)

1. **Answers only set a flag.** Each change to saved progress marks it "unsaved" and may start a timer. It does a few comparisons; it does not touch the network.
2. **The network is touched at checkpoints**, in the background: page load (one status check), a finished lesson or guided session (a few seconds later,
   coalesced), a quiet spell with unsaved work (2 minutes), the page being hidden or closed (one best-effort save), the connection returning, and "Save now".
3. **One request carries the whole batch**: the document, from the revision this device last saw.
4. **Everything is asynchronous and caught.** Errors become a status the learner can read; they are never thrown into the app. A request that never answers is cut
   off after 10 seconds; nothing queues behind a stuck attempt.

## Conflicts, retries and interrupted saves

* The save is **compare-and-swap**. If another device saved first, nothing is written and the answer carries the account's current copy.
* Copies are combined by a **union that loses nothing** (`features/sync/merge.ts`, `merge-guided.ts`): sessions and runs by id, finished beats unfinished, the more recent
  decision wins. Properties tested on 400 seeded random cases each: commutative, idempotent, **associative**, lossless. A separate `normalize` step tidies the
  union (one lesson in progress) when it is adopted; merging stays a pure union precisely so it can be associative (an earlier version that tidied inside the
  merge failed the associativity test, which is how this design was reached).
* **Interrupted**: if a save lands but its answer is lost, the next run finds a conflict whose copy equals the device's, marks it saved and writes nothing twice.
* **Edits during a save** are never lost: the fingerprint recorded is of what was *sent*; anything newer stays unsaved and goes next.
* **Failures back off** 15 s, 30 s, 1 min, 2 min, 5 min, then every 15 min (with jitter; `Retry-After` honoured). A 401 stops and asks to sign in; a document that is too large
  or from a newer app stops with a plain message instead of retrying forever.

## Consent

* **Nothing is uploaded without the learner's explicit consent**, recorded server-side (`consents`, kind `cloud_storage`, with the privacy-notice version).
* It is enforced **by the database**: `put_document` returns `consent_required` for anyone without the record, whoever calls it.
* Turning saving on lists exactly what is saved, in plain words, before asking. The learner can turn it off on a device at any time. (Deleting what is already in the
  account is Phase 6.)

## Guest progress and shared devices

* Saved progress is in **one folder per learner** on the device (`lib/scope/storage-scope`). The guest's folder is the original, un-prefixed one. Account folders can never see each other.
* **Importing guest progress into an account is explicit and never silent.** The dashboard *offers* it (what was found, in counts, and what will happen) and does nothing until the learner
  presses "Add to my account". Declining changes nothing. The guest's own progress is **only read**, never written, cleared or deleted, so adding it (or not) loses nothing.
* **Only the guest's folder can be offered.** Another account's folder on a shared device is never read for this, never offered, never merged. If the same guest progress already went to
  an account on this device, the next learner is told so ("only add it if it is yours").
* Merging is the same lossless union: what the account already had is kept.

## Honest status wording

"Saved to your account" appears **only** when a save has finished and nothing has changed since. Otherwise the learner sees what is true: *Progress on this device*, *Saving…*,
*Offline · saved on this device*, *Saved on this device* (retrying / signed out / too large / newer version). This is a pure function with its own tests (`status-text.test.ts`).

## Outages: a database that is down is not a signed-out learner

`getViewer` now distinguishes **unavailable** (Auth server or database unreachable) from **anonymous**. Sync, profile, admin and `me` routes answer **503 + Retry-After** for an outage and
401 only for a genuinely missing session, so an outage never tells anyone to "sign in again" and the engine knows to wait, not to stop.

## Server pieces

| Route | Does | Identity | Writes with |
|---|---|---|---|
| `GET /api/sync/state` | consent flag + revision of each document (no bodies) | verified session | nothing |
| `GET /api/sync/documents/:key` | the learner's own document | verified session, RLS | nothing |
| `PUT /api/sync/documents/:key` | compare-and-swap save | verified session; **cross-checked by RLS** (consent and rows are read through the learner's own session naming the same id) | service role, `put_document` only |
| `POST /api/sync/consent` | records consent | verified session | service role, `record_consent` only |

Every route: gated per request, same-origin on writes, rate-limited per learner (fail closed), `Cache-Control: private, no-store`, `Server-Timing: db;dur=…`. No route takes a user id.

## Measuring latency, and the outage proof

* `getMetrics()` on the engine (and "Connection details" on the dashboard) report count, p50, p95 and max of every sync call.
* **CI measures it** and prints it: `SYNC_LATENCY_MS` (real database, through verifying the session each time), `E2E_SYNC_LATENCY_MS` (whole stack, in a browser).
* **Outage proof**, three ways: (1) unit: the real lesson actions on the real stores complete in the same time with the network hung, refused, 500 or crawling, with zero requests while
  answering and no unhandled rejection (`outage.test.ts`); (2) browser: sync routes aborted, 503, 500 and never-answering, a lesson completes and every answer gets feedback quickly, and a
  save succeeds once the network is back; (3) **a second copy of the app whose database address is wrong**: a real server-side outage where the account routes answer 503 and the lesson
  still completes with nothing broken (`sync.spec.ts`, "a real database outage on the server").

## Not in this phase

Account recovery; export/delete of cloud data and the privacy notice sign-off (Phase 6); conflict *UI* beyond the status wording (merges are automatic and lossless, so there is nothing to choose);
an "undo import" button (the guest copy is untouched and the account keeps its last 10 revisions, so recovery is possible by hand); applying the profile's "practising" topics to recommendations.
