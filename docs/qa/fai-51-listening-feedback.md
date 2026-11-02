# FAI-51: listening coverage and automatic Migo feedback

## Root cause

PR #33 decorated `q1` only for `present-perfect-vs-past-simple`, behind the existing listening flag. The other twelve regular lessons recommended by the adaptive learner flow had no listening exercise. The production listening flag was enabled when investigated. We cannot infer the owner's exact lesson from this; the catalog coverage gap is confirmed in code.

## Change

Every current regular lesson receives an authored `q9-listening` comprehension check when the existing listening flag is enabled. Each scenario matches its grammar objective; all four choices are grammatical, so learners must understand the recording. Transcript remains hidden until answering or explicitly choosing the reading alternative. Existing questions, identifiers, grading and saved answers are preserved. Unfinished eight-question attempts gain the check once on resume; completed histories remain eight questions.

Correct and incorrect submissions trigger one short authored response; finishing a lesson triggers one celebration. Responses appear as text with replay/mute. Correct-answer and celebration phrases are shared/cacheable. Incorrect feedback uses a bounded authored grammar hint, never learner or AI-generated text. Unverified writing receives no false positive response.

Audio is optional and asynchronous. A shared audio element is primed during Check/Finish gestures for Safari; browser-denied playback offers replay without looping. Scoped, tab-local playback markers prevent repeat automatic playback on rerenders, refresh and retry clicks. New answer attempts can receive new feedback. Markers contain no answers and do not enter progress sync. Muted events are consumed without fetching audio; unmuting does not start them.

Existing ElevenLabs custom voice, provider cache, 50-call shared daily budget, separate ElevenLabs budget, bounded Coral fallback and endpoint safeguards remain unchanged. No authentication, invitations, database schema, production flags, infrastructure or billing changes.

## Verification

Browser coverage includes complete rendered lessons for all thirteen skills, correct/incorrect/retry/completion triggers, hidden transcripts, replay caching, refresh deduplication, persistent mute and simulated browser autoplay rejection. The shared paths also run under WebKit and emulated iPhone Safari. Existing microphone denial, transcript editing, typing fallback, local persistence and owner-preview restrictions remain regression checks.

Physical iPhone Safari, actual speaker output/voice quality and adult-learner acceptance remain pending owner/device testing. Browser audio endpoints use deterministic WAV fixtures, not paid provider calls. No physical-device or real-audio acceptance is claimed.
