# Regular lesson speaking acceptance (FAI-46)

Production stays off until the owner approves release. Build a preview with `NEXT_PUBLIC_LESSON_SPEAKING=true`. No production settings are changed by this document. The default/off build keeps the existing written exercise and stored session IDs unchanged.

The first speaking exercise is question 8 of Present perfect vs. past simple. It asks for two sentences: something you have done this week and something you did yesterday. The existing local tense/time rubric checks the confirmed text. Other ordinary answers never wait for transcription or account sync.

## A real learner's exercise

Run this with an invited adult learner on a physical phone, with consent to send a short recording to OpenAI for transcription. Record device/browser, date, observer, learner feedback, and pass/fail. Do not put their raw audio, identity, or private answers in the report. Browser fake-microphone tests are separate and do not constitute this sign-off.

1. Reach question 8. Read the objective and privacy notice. Recording must not start automatically.
2. Say: “I have visited my friend yesterday. I watched a film yesterday.” Stop recording.
3. Read “What we heard.” Correct any recognition mistakes. Before “Use this transcript,” no grammar result or attempt should be recorded.
4. Confirm the transcript and check the answer. The feedback should explain that a finished time such as yesterday takes the past simple. It should not mention accent or pronunciation.
5. Retry with: “I have visited my friend this week. I watched a film yesterday.” The learner may type this correction or record it again. A recording must be reviewed again before checking.
6. Finish the lesson; refresh and open the review. Confirm the attempt history is retained. Check that the learner understands the difference between an audio-recognition error and a grammar correction.
7. Repeat with microphone access denied, then with the service unavailable/offline. Complete by typing; a failed recording must never create a wrong grammar attempt.
8. Cancel while permission is pending and during transcription. Granting a dismissed permission later must not activate recording; a late result must not replace a typed draft. Navigate away and verify the microphone indicator turns off.
9. Sign out and sign in as another invited test learner. The previous learner's draft/transcript must not appear. Do not use real students' credentials for automated testing.

Acceptance remains pending until this is actually run. No real-learner or physical-device sign-off is claimed by the implementation.

## Bounds and retention

The existing recorder caps capture at 30 seconds and 32 kbps where supported. The existing `/api/ai/transcribe` endpoint validates content type and a 300,000-byte audio limit. It shares the existing transcription counters (4/minute, 20/day per visitor by default) and the global daily AI call cap (300 by default); it cannot create an unmetered route. Server/provider timeout is 20 seconds; the client times out at 22 seconds and can abort its request. A pending permission prompt is abandoned after 10 seconds, with late streams released.

Only transcription is paid. Grammar judgement, hints, retries, and lesson progression use the existing deterministic lesson engine. Requests are not retried automatically. Audio remains in memory in the browser until uploaded, and Grammigo does not persist or log it. The provider's API retention policy still applies. Only learner-confirmed text becomes normal versioned lesson progress; unconfirmed transcripts stay in component memory and are discarded when leaving or changing account scope.

No new monetary price estimate is asserted here. Provider rates must be checked before release. TTS has a separate implementation and usage budget.

## Automated verification

Unit/component tests cover explicit transcript confirmation, editing, failures, typing, cancellation, late microphone grants, and upload aborts. The browser suite uses fake microphone input and mocked transcription responses; it covers a grammar error and correction/retry, a recognition correction, refresh, service failure, typing without a paid API, absence of account/sync requests, and no audio payload in localStorage. Run a speaking build with `E2E_SPEAKING=1 npx playwright test e2e/speaking.spec.ts`.
