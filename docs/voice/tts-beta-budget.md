# FAI-53: Migo beta synthesis reliability and budgets

## Confirmed original fallback cause

Read-only production inspection on 2026-11-02 found `TTS_DAILY_CALL_CAP=50`, no ElevenLabs daily override, and therefore the old primary default of **20 attempts/day**. Durable counters were shared TTS **36** and ElevenLabs **32**. Legacy denied checks also incremented counters; 32 did not represent 32 paid calls. The independent primary quota explained Coral routing while the shared cap still had room. Shared-cap exhaustion would return audio unavailable. Earlier provider failures cannot be reconstructed from the old logs.

## Proposed server-only configuration

| Variable | Beta default | Meaning |
| --- | --- | --- |
| `TTS_DAILY_CALL_CAP` | `300` | Shared dispatched synthesis attempts per UTC day, across ElevenLabs and Coral. |
| `ELEVENLABS_DAILY_CALL_CAP` | `300` | ElevenLabs attempts per UTC day. |
| `ELEVENLABS_MONTHLY_CREDIT_BUDGET` | `100000` | Approximate conservative Grammigo credit reservations per UTC calendar month. |

Daily values accept non-negative integers, bounded at 1,000; monthly values accept 0..10,000,000. Zero disables that budget. Missing/empty/invalid values retain beta defaults. The existing production TTS override is still 50 until an approved environment update/deployment. Set all three variables explicitly on release. This PR changes neither provider billing settings nor the production key.

Balance, production/local key identity and exact billing reconciliation are not independent release gates under the owner's latest direction. Application reliability, bounded attempts and passing tests are the gates. **No merge or deployment is authorized.** `vercel.json` disables automatic deployments for this review branch only.

## Atomic reservations and bounded failures

One Redis Lua script checks the shared daily allowance and, for ElevenLabs, its daily allowance plus monthly credit headroom **before changing any counter**. A denied check writes nothing: it neither inflates paid-attempt counters nor reserves monthly credits. Only an admitted provider attempt increments its applicable counters. Coral needs its own shared slot; a failed primary cannot obtain an uncounted fallback. Simultaneous requests across instances cannot over-admit either provider or the shared/monthly budget.

All applicable counters are read and validated before writes. This matters because Redis script runtime errors do not roll back earlier writes. Non-integer/corrupt counters fail closed before mutation; errors returned by Redis and malformed responses never authorize synthesis. Limits are non-negative safe integers and bounded by configuration.

Reservations for dispatched requests are retained on HTTP rejection, timeout, network failure, invalid audio or uncertain billing. There are no automatic synthesis retries or refunds; this prevents repeated failures from creating unlimited provider attempts. This is intentionally conservative and may stop earlier than actual billed usage. A lost Redis response is also treated as uncertain and fails closed; any reservation retained in that case expires with its UTC period. There are no permanent locks or quota leases. Failures return generic audio-unavailable responses while lessons remain usable.

Daily keys contain the UTC date and day bucket; monthly keys contain the UTC year/month. Fixed expirations are set to five seconds after the corresponding boundary. Denied requests do not extend expirations. A new day resets daily headroom while retaining the current month's credits; a new month starts a fresh monthly counter. Existing production key names are retained, so deploying cannot reset already consumed allowances. Historical denied counts in legacy keys remain conservative until that period ends; this change does not rewrite production usage.

Existing visitor and shared AI request guards remain unchanged. Those guards count requests, including cache hits/denied requests, to retain abuse protection; they are distinct from synthesis allowances. Local pending-request coalescing is an optimization, not quota enforcement. The server cache retains 24 entries, 24h primary audio and a 60s fallback clip under the primary identity. Browser cached replay, persistent mute, lesson progression, auth/origin/input checks, provider timeout/redirect/audio bounds and Coral's shutdown gate remain intact.

## Approximate credits: known limitation

The fixed model is `eleven_multilingual_v2` and the fixed Migo voice is generated (no Voice Library sharing surcharge). Read-only metadata checked on 2026-11-02 reported `character_cost_multiplier=1` and `cost_discount_multiplier=1`. The app reserves `text.length` credits using that validated current rate, conservatively counting UTF-16 units; it does **not** assume one call equals one credit.

This is approximate accounting, not exact invoice reconciliation. Provider responses can expose `character-cost`, but this focused change does not implement a financial reconciliation system or dynamically refresh pricing. Revalidate the rate when changing model/voice/plan or when provider pricing changes. Missing response metadata and uncertain failed attempts do not trigger refunds. Submitted character reservations can differ from actual provider billing. The app budget cannot add credits, change provider overage settings or force a rejected synthesis to succeed. HTTP errors, exhausted credits and timeouts route to Coral within its remaining shared allowance.

The monthly counter tracks Grammigo from activation, excluding earlier spending and other apps. UTC calendar months may differ from the subscription renewal cycle. Do not present it as an account-wide monthly billing guarantee. Account balances/identifiers/keys are not exposed to learners or app diagnostics.

At 300 primary attempts/day for 30 days, there are up to 9,000 attempts. With 100 characters/clip that would reserve about 900,000 credits before the monthly guard. A 100,000-credit budget instead admits roughly 1,000 such clips, or 4,000 clips averaging 25 characters. This is a ceiling/scenario, not a forecast. Cache hits require no new synthesis reservation. Coral uses separate OpenAI billing and is bounded by shared attempts; subscriptions and overage settings are unchanged.

## Diagnostics and verification

`[tts-diagnostic]` contains only event, allowlisted reason, provider and optional HTTP status. Reasons distinguish primary daily/monthly denial, shared denial, missing primary configuration, provider HTTP/network/timeout/invalid-audio failure, unavailable quota storage and retired Coral. Raw errors/bodies, authored text, credentials, account balances, names and IPs are never logged. No new learner-facing usage endpoint/header is added. A fallback log records a routing decision; Coral still requires its own reservation.

The exact-equality sync failure was fixed by deterministically ordering evidence with tied timestamps before floating-point summation. The equality assertion is unchanged; a regression checks identical results across rotations/reversals of the same evidence. The original implementation produced two distinct scores for that fixture.

Unit/component tests cover denial without consumption, smaller valid requests after denial, shared/primary competition, UTC boundaries, safe failures and cached fallback. Existing mobile/desktop smoke tests cover replay, persisted mute, disabled synthesis and uninterrupted lesson progression. An opt-in integration test executes the actual Lua script against isolated expiring keys in existing Redis storage:

`TTS_QUOTA_LIVE=1 node --env-file=<private-existing-storage-env-file> node_modules/vitest/vitest.mjs run src/features/voice/budgets.live.test.ts`

The live test never touches production budget keys or synthesizes audio. Normal CI skips it without explicit opt-in and storage credentials. See PR #35 for executed verification results.

References checked 2026-11-02:
- https://elevenlabs.io/docs/api-reference/models/list
- https://elevenlabs.io/docs/api-reference/voices/get
- https://elevenlabs.io/docs/api-reference/introduction/
- https://elevenlabs.io/docs/help-center/product/voices/voice-library/what-are-custom-rates-and-credit-multipliers
