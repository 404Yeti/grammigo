# Listening, sentence building and custom Migo voice (FAI-50)

Scope: the existing Present perfect vs past simple lesson. `NEXT_PUBLIC_LESSON_LISTENING=true` opts its first recognition item into an authored listening scenario. The question asks what the speaker reports about Hanoi; every choice is grammatical, so the relevant information comes from the audio. The transcript is absent from the DOM until the learner answers, or explicitly chooses Read instead (the accessible accommodation for mute, hearing access, offline and provider failures). This remains grammar learning, not a scored hearing test. Replay/mute use the existing Migo controls, with no autoplay.

The lesson's final sentence-construction item is q5 (q8 is already the separate independent-production exercise). With the existing speaking flag on, q5 retains word tiles and adds Speak or type my sentence. Reviewed speech and typing use exactly its existing ordered-word grammar rules. The question IDs, option IDs/labels, accepted answers, eight-record session shape and storage version are unchanged; old progress is neither migrated nor regraded. No paid grading call is introduced. Other lessons, diagnostic scoring, authentication, invitations and Guided gating are unchanged.

## ElevenLabs primary, Coral fallback

`ELEVENLABS_API_KEY` is read only in the server-only provider module. The fixed supplied voice is `v50G5ovlVt3QsSRU1EhH`, using `eleven_multilingual_v2`; no new SDK dependency. Only bounded, public authored lesson copy is sent. Learner answers/audio/names are never sent to ElevenLabs. All speech variants, including the new `listening` kind, use this primary provider when the key is configured. Existing Coral remains the bounded fallback on provider failure, missing credentials or the independent ElevenLabs quota.

The visitor limits remain unchanged. See [beta budgets and investigation](tts-beta-budget.md) for configurable paid attempt and monthly credit limits. Production remains at 50 shared attempts until an approved environment update/deployment. **Each actual primary and fallback attempt reserves its own shared slot.** A failed primary cannot buy an uncounted fallback. `TTS_DAILY_CALL_CAP` and `ELEVENLABS_DAILY_CALL_CAP` now default to 300 (maximum 1,000 each); `ELEVENLABS_MONTHLY_CREDIT_BUDGET` defaults to 100,000 conservative character-credit reservations for the fixed model/voice. Inputs remain <=320 characters; account billing settings are unchanged. Quota exhaustion falls back within the remaining shared cap; limiter outages fail closed. Primary timeout5s; Coral7s; no automatic retries. Both responses are streamed with a256KB bound; invalid, empty, non-audio and oversized responses fail safely. Redirects never receive the ElevenLabs credential.

Server cache keys include provider/model/voice and text, with24 bounded entries and concurrent coalescing. Custom audio expires after24h; fallback under the custom identity expires after60s so a short outage does not pin Coral indefinitely. Existing browser replay/mute cache stays intact. Count-only provider usage is available through the existing development-only usage endpoint; actual provider invoice cost is not inferred. Coral's existing January6,2027 shutdown gate applies only to Coral, and no longer disables a working ElevenLabs primary.

Official references:
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- https://elevenlabs.io/docs/api-reference/voices/get
- https://elevenlabs.io/docs/api-reference/user/subscription/get
- https://developers.openai.com/api/docs/guides/text-to-speech

## Secure setup and acceptance

The key was absent locally and in Vercel Production when checked. Account access and the supplied custom voice **are not yet verified**. Add the key through Vercel's secret environment settings, never chat, source control or a NEXT_PUBLIC variable. If it is stored as Sensitive, Vercel does not allow reading it back; local account validation requires the key to be supplied securely to the verification process as well. Do not deploy or activate the new provider before owner voice testing/approval. Production was not changed by this PR.

Automated checks use synthetic browser audio and mocked provider responses; they do not prove custom voice access, human listening quality or physical iPhone behavior. Before release, verify the exact voice using the owner's ElevenLabs account and one bounded synthesis; listen to the resulting sample, check provider usage, and approve it. Then test real iPhone playback/replay/mute, mic denial, transcription failure, transcript correction, grammar retry and typing/reading accommodation. An adult learner should confirm the listening question is clear. Keep physical-device/adult/voice listening acceptance marked pending until actually performed.
