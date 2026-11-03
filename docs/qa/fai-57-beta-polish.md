# FAI-57 beta polish

Three fixed positive phrases rotate on resolved feedback events, retaining the current phrase on replay. Question-specific praise, explanations and grading remain intact. Phrases share the existing public text-based server/browser clip caches; there is no language-model call.

Success builds a deterministic debrief from the saved session: topic, independently correct exercises, answers corrected with help/retry, unverified responses, and the latest speaking feedback when confidence is high. Speaking success additionally requires meets_goal with no reported errors. One review action is selected from a question that needed help or correction, otherwise from speaking feedback that needs work. No transcript or AI-authored prose is sent to TTS. This deliberately summarizes speaking feedback categories rather than repeating potentially unsupported model claims.

The versioned learner-scoped device cache freezes result signals on the first Success visit. There is no database or progress-document migration. Corrupt/unavailable storage falls back to the saved outcomes and memory. Text remains visible with voice disabled, muted, denied autoplay, quota denial, provider failure or offline playback. The current completion event remains the only automatic playback trigger; revisits require explicit replay.

Debrief audio uses the existing ElevenLabs Migo / Coral path and all existing request and synthesis budgets. The browser additionally retains up to 24 debrief clips per learner with IndexedDB (including WebKit). Refresh/replay can reuse those clips without another TTS request; unsupported/cleared/evicted storage falls back to the existing memory/server cache. Device caches are not cloud-synced. Summary signals contain no transcripts. Existing single-player ownership and unmount cancellation remain; an immediate ref lock prevents duplicate requests from rapid clicks.

Expected incremental usage: zero AI text-generation calls. At most three newly synthesized shared positive clips per server cache lifetime, rather than one; replay uses cache. A new uncached debrief normally costs one admitted ElevenLabs attempt, reserving its character count under the current budget configuration (typically roughly 300–600 characters). A primary failure may use one additional admitted Coral attempt. Muted audio costs zero; cache hits cost no synthesis. Existing daily/monthly limits are unchanged. Actual currency cost depends on the subscribed provider plan. No paid provider was called during automated verification.

Summary copy targets roughly 20–35 seconds; actual delivery varies with topic, evidence and provider pacing and has not been timed with live synthesis. The bounded MP3 limit increases from 256 KB (~16 seconds at the configured 128 kbps) to 768 KB to accommodate this duration without truncating audio. Timeouts remain unchanged. Text and progression never wait for audio. No authentication, activity, Progress, curriculum, quota configuration, merge or deployment changes. Vercel automatic deployment is disabled for this review branch.

## Verification

- Existing voice/completion regression selection: 60 passed, 1 opt-in live test skipped.
- New debrief/server/cache/recovery selection: 16 passed.
- Final debrief and clip-cache rerun: 7 passed; final audio component rerun: 8 passed (including rapid-click request coalescing).
- `npm run lint`: passed.
- Production build with all lesson/voice preview flags and `--webpack`: passed, including TypeScript and 115 generated pages. Default Turbopack hit an environment port-binding error in its CSS worker; no configuration change was made to the default build.
- Mobile/desktop Playwright and the full unit suite: running when the review PR was opened; final results are recorded in the PR and Linear.
- Live provider/audio timing and real-device listening: not performed. All test audio is mocked.

The first CI run exposed WebKit Cache Storage replay misses after reload (Chromium/Firefox passed). Audio persistence now uses IndexedDB with bounded transactions, checked by the same retained cross-browser replay assertion, now also checking the 24-clip bound.
