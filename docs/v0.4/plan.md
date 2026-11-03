# Grammigo v0.4 — Speak, Track, Progress

Baseline: PR #35, ccbd232. Three independent slices; implement/review Phase 1 before starting either later slice. No merge or deployment authorized.

| Phase | Linear | Implementation and verification |
| --- | --- | --- |
| 1 — Speak | FAI-54 | Final regular-lesson speaking step, authored grammar/CEFR prompt, existing MigoAudio/Whisper/AI, confirmed transcript, concise feedback, one correction, scoped resume and explicit skip. Unit content/storage/sync/isolation, guarded API integration, component and mobile/desktop browser tests. |
| 2 — Track | FAI-55 | Compact HomeScreen month calendar and current/longest streak/active-day counts derived exclusively from completed sessions. Use local date components and calendar-day arithmetic, never elapsed 24-hour periods. Test month/year/leap/DST/timezone boundaries and keyboard/small-screen use. |
| 3 — Progress | FAI-56 | Activate Progress navigation with completed lessons, practiced topics, CEFR-tagged evidence, review needs and recent activity. Reuse deriveLearning/profile/recommendations and scoped store. Show evidence counts and provisional placement caveats; no invented proficiency scores. Test empty/sparse/mixed evidence, scoped accounts and browser navigation. |

## Repository findings

- `SessionScreen`, `practice/session.ts`, `practice/actions.ts`: deterministic question flow; completion triggers celebration and existing success/review routes.
- `data/lessons/index.ts`: 13 regular lessons from curriculum, optional existing listening and spoken construction adaptations. Preserve question IDs, order and grading.
- `SpeakingAnswer`, `ai/use-voice-capture.ts`, `ai/client.ts`, `handleTranscribe`: 30-second recording, Whisper, learner transcript review, typing fallback and capture cancellation.
- `ai/service.ts`, `handlers.ts`, `lib/ai/guard.ts`: structured, sanitized target-grammar assessment, timeouts, same-origin and existing writing rate/global budget controls.
- `MigoAudio`, `voice/content.ts`, `voice/server.ts`: authored-only TTS, automatic speech arbitration, cache, mute/replay, ElevenLabs quotas/monthly budget and Coral fallback. Extend only authored content lookup.
- `types/session.ts`, `lib/storage/schema.ts`, `storage/store.ts`: validated version-2 sessions and writing feedback; localStorage is isolated by `storage-scope`.
- `sync/merge.ts`, `doc-adapters.ts`: whole-session conflict resolution by completion/update time; optional fields travel with the winning session. Existing account sync/consent/RLS remains in place.
- `HomeScreen`, `learning/events.ts`, `derive.ts`, `profile.ts`: completed timestamps and real exercise/diagnostic evidence already exist. Progress navigation is currently inactive.

## Migrations and compatibility

Phase 1 adds optional validated `session.speakingChallenge` within `lessons_v2`; no new table, document key, version bump or SQL migration. Existing database document validation checks envelope/version/size rather than session field lists. Missing extension means challenge has not begun. Invalid extension is discarded without discarding exercises. Completed historical sessions are never reopened or regraded. In-progress legacy sessions reach the final step through their existing final feedback. Challenge evidence is supplemental and does not alter deterministic mastery, recommendations or scores. Audio is never persisted; recognized draft, submitted words and feedback are saved. Reload during an API request keeps submitted words as unverified; recording audio cannot survive reload.

Older deployed clients tolerate the optional field, but their UI does not enforce the new step and they may finish without it. Existing whole-session last-update conflict rules still apply; concurrent device editing does not merge individual challenge attempts. No migration/backfill should fabricate historical speaking results.

Phase 2 can derive historical dates from completion timestamps in the viewer's current local timezone. Completion-time timezone was not historically stored: do not claim it is known. Use one explicit consistent policy in the UI/tests; if fixed completion-local dates are desired later, add optional date/timezone metadata only for new completions, without inventing historical dates. Phase 3 requires no migration because it derives existing evidence. Reassess only if implementation uncovers missing evidence.

## Phase 1 review limits

Mock external providers in automated verification. Live microphone, ElevenLabs voice quality and pedagogical prompt/feedback acceptance remain manual checks; no paid live requests or production changes are required for this PR. Phases 2 and 3 remain planned only.
