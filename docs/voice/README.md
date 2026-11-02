# Migo's optional voice (FAI-47)

The UI requires `NEXT_PUBLIC_MIGO_VOICE=true`; the server additionally requires `MIGO_VOICE_ENABLED=true`, the existing enabled OpenAI integration and its durable production limiter. Both switches are off by default. Do not change production flags or deploy without owner approval.

Only authored public lesson copy can be spoken: an instruction, encouragement, explanation/model answer, or numbered hint selected by IDs. The endpoint rejects arbitrary `text` and unknown fields. Learner answers, names and account data never become synthesis prompts or cache entries. This is short hosted speech, not a conversational agent.

## Playback and privacy

There is no navigation/answer-triggered autoplay. Listen/Replay are explicit controls; browser playback restrictions leave the clip ready for another user gesture. Muting stops current playback and aborts an outstanding browser request. The preference is a validated version-1 localStorage record, independent of account progress. The text always remains available. The UI identifies the voice as AI-generated.

The process cache holds at most 24 authored clips (maximum 256,000 bytes each); the browser cache holds at most eight object URLs, revoked on eviction. Cache contents are public lesson audio only and never contain learner responses. Serverless cache reuse is best effort, not a promise of durable caching. Requests do not trigger automatic provider retries.

## Bounds and cost reporting

Model: `gpt-4o-mini-tts`; voice: `coral`. Source text is capped at 320 characters, provider timeout at 15 seconds, browser timeout at 18 seconds, and returned audio at 256,000 bytes. TTS uses separate visitor counters (6/minute, 40/day by default), the shared daily AI cap, and a separate paid-call daily cap (`TTS_DAILY_CALL_CAP`, default 50, maximum 100). Cache hits do not consume the paid-call cap; concurrent identical prompts share one synthesis operation. Limiter failures fail closed.

Official model pricing checked 2026-11-02: $0.60 per million text input tokens and $12 per million audio output tokens. An illustrative 100-input/300-output-token clip would cost about $0.00366. This is an example, not measured usage or a guaranteed per-clip cost. The character/byte limits are output bounds, not billing-token measurements. Source: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts .

No real paid TTS call or billed cost is claimed by mocked automated tests. Instance-local usage records count calls, failures, characters, output bytes, cache hits and latency; `/api/ai/usage` exposes totals only in development, and is still 404 in production. Optional counts-only logs contain no source text or learner content. Actual billed tokens and dollars must be checked in the provider's usage dashboard during owner acceptance.

## Scheduled provider shutdown

Official documentation checked 2026-11-02 lists the Speech API models for shutdown on **2027-01-06**. The adapter fails gracefully from that date; lessons keep working silently. The replacement has a different API workflow, so changing a model name alone is not a migration. FAI-48 tracks migration and voice revalidation before release longevity becomes a risk. Existing Whisper transcription is also scheduled for shutdown on 2027-02-26; this slice does not change that production integration. Source: https://developers.openai.com/api/docs/deprecations .

## Acceptance still required

Use a preview and the owner's existing API configuration; do not add a new key or change production. On physical iPhone Safari and Android Chrome, verify Listen/Replay, mute persisted across refresh, no autoplay between exercises, graceful failure/offline behavior, and typing with sound off. Listen to Coral for intelligible grammar instructions and corrections. Confirm actual counts/costs in provider usage. Record device/date/results without learner audio or private account data. Automated mock playback is not a listening-quality or physical-device sign-off.

Figma expressions come from page 02: Listening `4:152`, Confused `4:170`, Sleeping `4:187`. Exported assets are reused; no generated replacement mascot is used.
