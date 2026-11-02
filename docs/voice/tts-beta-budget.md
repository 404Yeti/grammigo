# FAI-53: Migo beta synthesis budgets

## Confirmed cause (read-only inspection, 2026-11-02 UTC)

Production has `TTS_DAILY_CALL_CAP=50`, no `ELEVENLABS_DAILY_CALL_CAP` override, and therefore the old ElevenLabs default of **20**, not 50. The current UTC-day durable counters were: shared TTS **36**, ElevenLabs **32**, shared AI guard **77**. Denied quota checks also increment counters: 32 does **not** mean 32 paid ElevenLabs calls. The exhausted independent 20-attempt primary quota routes to Coral while the shared cap still has room. Exhausting the shared 50 cap would return unavailable, not permit Coral. Existing code suppresses provider failure details, and the requested 24h logs exceeded Vercel Hobby retention; earlier provider failures cannot be excluded or reconstructed. No production synthesis was requested to diagnose this.

Using the local ElevenLabs key, free metadata requests succeeded for subscription/model/fixed voice. Multilingual v2 reports character-cost and discount multipliers of 1; the voice is generated, without a sharing surcharge. Subscription metadata distinguishes used credits from the total allocation. Current account balances are reported privately to the owner, not recorded in app diagnostics. Production's sensitive key cannot be exported to compare with the local key, so that observation is conditional on both keys belonging to the same account.

## Review configuration (not applied to Vercel)

| Server variable | Beta default | Meaning |
| --- | --- | --- |
| `TTS_DAILY_CALL_CAP` | `300` | Shared paid attempt ceiling per UTC day. Every actual ElevenLabs AND Coral attempt requires a slot, including failures. |
| `ELEVENLABS_DAILY_CALL_CAP` | `300` | Independent primary attempt ceiling; exhausting it permits bounded Coral fallback. |
| `ELEVENLABS_MONTHLY_CREDIT_BUDGET` | `100000` | Conservative Grammigo reservation ceiling for the fixed one-credit-per-character model/voice per UTC calendar month. |

Daily settings accept non-negative integers, bounded at 1,000; zero stops synthesis for that budget. Monthly settings accept 0..10,000,000; zero disables paid ElevenLabs synthesis. Missing, empty or invalid settings use beta defaults. These are server-only variables; no client usage endpoint/header is added.

**Before an approved deployment:** change the existing Vercel production `TTS_DAILY_CALL_CAP` from 50 to 300; set `ELEVENLABS_DAILY_CALL_CAP=300` and `ELEVENLABS_MONTHLY_CREDIT_BUDGET=100000` explicitly for operator visibility. Existing environment overrides take precedence over defaults. This PR does not change Vercel settings. Do not merge or deploy without owner approval.

The existing shared AI request budget and per-visitor guards are unchanged. Cache hits still pass those guards, so they can reduce the reachable synthesis volume. Cache/coalescing remain per-instance (24 entries, 24h primary / 60s fallback under primary identity); warm replay often avoids synthesis, but cold starts and different instances can synthesize the same copy again. Browser replay and persistent mute are unchanged. Existing auth/origin/input protections and provider timeout/size/redirect bounds are untouched.

## Credits, concurrency, and limits of accounting

Calls are not credits. Fixed `eleven_multilingual_v2` plus this generated voice currently costs one credit per submitted character. Reserve `text.length` credits before dispatch (UTF-16 length conservatively overcounts non-BMP characters). Keep reservations after failure, timeout or later shared-budget rejection: billing may be uncertain, so this can stop earlier than actual invoice usage. No retries or refunds. Recheck provider pricing/model/voice before changing that fixed identity; this is a conservative application spending guard, not invoice reconciliation.

Redis runs one Lua script to check and reserve the entire credit amount atomically; concurrent requests across instances cannot overrun the cap. Denied credit reservations do not consume remaining credit headroom. UTC month keys and fixed expiration avoid a shifting monthly-window bucket. Storage errors fail closed before any provider call. Daily reservations retain the existing atomic Redis `INCR` checks for each provider attempt; local in-flight coalescing is an optimization, not quota enforcement.

The new counter starts at activation and tracks **only this Grammigo implementation**, not earlier usage or other apps/keys. It resets on UTC calendar months, which may differ from the ElevenLabs subscription billing cycle. It must not be advertised as an account-wide 100k billing-period guarantee. For an activation partway through the month, choose a remaining-period allowance after checking prior usage; verify the actual remaining credits on the production account privately before activation. Provider API-key spending controls remain the source for an account/key billing hard stop. Do not assume raising this cap adds credits or enables overage.

## Expected monthly usage / cost exposure

At 300 primary syntheses/day for a 30-day month, there are at most 9,000 attempts. Before the monthly guard, that is:

| Average submitted clip length | Monthly character-credits at full daily usage |
| --- | --- |
| 25 | 225,000 |
| 100 | 900,000 |
| 320 (input maximum) | 2,880,000 |

The monthly reservation ceiling instead permits at most **100,000 newly reserved character-credits per full UTC month** (up to 100,000 at activation in a partial month unless reduced manually). This corresponds to about 4,000 25-character clips, 1,000 100-character clips, or 312 full 320-character clips, before conservative failed-attempt reservations. It is 82.4% of the stated 121,314 monthly allocation, leaving 21,314 for other use in a fresh allocation. Actual beta usage cannot be predicted from the counters: cache reuse, clip lengths, active learners and instance churn determine demand. This is a ceiling/scenario estimate, not a forecast or dollar invoice.

Coral does not consume ElevenLabs credits, but has a separate OpenAI cost. Its attempts share the 300/day TTS ceiling, at most 9,000/30 days if every attempt is Coral; a failed primary consumes a slot as well. Existing usage logs record counts; confirm actual OpenAI charges in its billing dashboard. No billing settings are changed.

## Diagnostics and verification

`[tts-diagnostic]` lines record allowlisted event/reason/provider and optional HTTP status only: `elevenlabs_daily_cap`, `elevenlabs_monthly_credit_budget`, `elevenlabs_not_configured`, `provider_http`, `provider_timeout`, `provider_network`, `invalid_audio`, `shared_daily_cap`, `limiter_unavailable`, `credit_budget_unavailable`, `coral_retired`, and generic provider failure. These are emitted even if optional usage logs are off. No text, raw errors/bodies, key, user identifiers or IP addresses are logged. A fallback event records the routing decision; fallback still requires its own slot and may fail. Responses remain generic audio/unavailable responses.

Verification uses mocked providers/storage and synthetic browser audio; no paid audio is needed. See the PR for executed commands/results.

References checked 2026-11-02:
- https://elevenlabs.io/docs/api-reference/models/list
- https://elevenlabs.io/docs/api-reference/voices/get
- https://elevenlabs.io/docs/api-reference/user/subscription/get
- https://elevenlabs.io/pricing
