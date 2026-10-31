# Real-device test checklist: Fix it with Migo (voice)

**Status: NOT RUN.** Nothing below has been performed on real hardware. Voice has only been exercised with Chromium's *fake* microphone in automated tests, and browser emulation does **not** count towards this checklist. The release blocker `real-device-testing-pending` stays open until a person has run this on the devices below and the results file is filled in and reviewed. Only then may `VALIDATION_SIGNOFF.realDevices` be flipped (a deliberate, reviewed code change).

## 0. Why this matters (known risks to look for)

| Risk | Why it is a risk | Where it shows |
|---|---|---|
| Safari records `audio/mp4`, may ignore the 32 kbps hint | The server caps audio at **300 KB** and accepts `audio/mp4`; a 30 s Safari clip may be larger than Chromium's ~120 KB | TC-06 |
| **The transcriber may "fix" grammar** | Speech-to-text models often write what the speaker *meant* ("I have gone") rather than what they *said* ("I have went"). That would hide the very mistake the activity exists to catch, and could award credit for an error | TC-08 (most important) |
| User-gesture timing | The first tap awaits a permission query before opening the microphone; Safari can be strict about gesture timing | TC-01 |
| iOS permission is per-visit/per-origin and easy to revoke | Learners may be stuck after "Don't Allow" | TC-02, TC-03, TC-04 |
| Background / interruption | Calls, lock screen and app switching stop recording | TC-13, TC-14 |
| On-screen keyboard | May cover the Check / Looks-right buttons | TC-09, TC-21 |

## 1. What you need

* **Devices (minimum):** an iPhone on current iOS Safari (primary); a second iPhone or iPad on an older supported iOS if available; one Android phone on Chrome. Optional: macOS Safari, desktop Chrome.
* **People:** at least 3 speakers, ideally including learners with different first languages and accents (TC-07/TC-08 are only meaningful with real learner speech).
* **Places:** a quiet room and one noisy one. Optional: Bluetooth headset, wired headset.
* **A secure (HTTPS) address.** Browsers only open the microphone on HTTPS (localhost is the only exception, and does not apply to a phone). **Choosing how to serve it is the owner's decision** (for example a private preview deployment, which means pushing the branch and needs the owner's explicit approval, or a temporary HTTPS tunnel to a local build). **Never test on the public production site: the feature is hidden there by design.**
* **A build with the feature visible:** `NEXT_PUBLIC_GUIDED_PREVIEW=true npm run build`, and the development AI configuration enabled (`AI_FEATURES_ENABLED=true` with a key) so `/api/ai/transcribe` works. Voice cannot work with AI off; the Speak tab is disabled in that case (that is expected behaviour, and TC-00 checks it).
* A way to see the network request and blob size (Safari Web Inspector from a Mac, or Chrome remote debugging for Android). If unavailable, record the HTTP outcome the learner sees.
* The results sheet: `real-device-results.template.csv` (one row per device × test).

## 2. Run order and pass criteria

Run every case on every device. **P0** cases must pass on the iPhone Safari and the Android device before the blocker can be considered for closing. A fail on any P0 is a stop. Record what happened, not just pass/fail; attach a screenshot or screen recording where it helps. Do not "retry until it passes": record the first result.

| ID | P | Case | Steps | Expected |
|---|---|---|---|---|
| TC-00 | P1 | AI off | Run once with AI disabled | Speak tab is disabled with a short explanation; typing works; nothing breaks |
| TC-01 | P0 | First permission flow | Open the activity, tap **Speak** → mic button | Plain-language explainer appears first; **Continue** triggers the browser prompt; **Allow** opens the mic and shows the Stop button with a running timer |
| TC-02 | P0 | Permission denied | Repeat, choose **Don't Allow** | Neutral message ("The microphone is off…") plus the "To turn it on" help; no attempt counted; **typing still works and Check gives a normal result** |
| TC-03 | P1 | Permission revoked mid-session | Allow, then revoke in device settings, return to the app, tap the mic again | Same as TC-02, no crash, no stuck spinner |
| TC-04 | P1 | Allow after deny | Follow the on-screen help to enable the mic, return, tap **Try speaking again** | Recording works without reloading the page |
| TC-05 | P0 | Record / stop / auto-stop | Record 5 s and tap Stop; then let one recording run past 30 s | Both end cleanly; the 30 s one stops by itself and still transcribes |
| TC-06 | P0 | Audio format and size | Record a full 30 s clip; note MIME type, byte size and the HTTP status of `/api/ai/transcribe` | Under 300 KB and HTTP 200. **If larger (413) record the size: this is a finding, not a pass** |
| TC-07 | P0 | Transcription accuracy | Each speaker says 10 natural valid answers (list below) at normal speed. Compare transcript to what was said, word by word | Record per-speaker word accuracy and any systematic misses (names, accents, numbers). No pass threshold is set here; the owner and educator decide what is acceptable |
| TC-08 | **P0** | **Does the transcript keep the learner's mistake?** | Each speaker says 10 answers that contain the target mistakes, *exactly as written* (list below), without correcting themselves | Record, per sentence, whether the transcript preserved the error. **If the transcriber silently corrects mistakes, the spoken path can hide errors and credit learners wrongly. That is a design problem to raise, whatever the pass/fail count.** |
| TC-09 | P0 | Transcript editing | On the "Did I hear you right?" screen, edit words with the iOS keyboard, then **Looks right — check it** | Edits are kept, no autocorrect/capitalisation surprises, keyboard does not hide the buttons; judged on the edited text |
| TC-10 | P1 | Spoken self-correction | Say "I have went… I mean, I went to the cinema" | Record the transcript and the verdict; the final sentence should be what is judged |
| TC-11 | P1 | Say it again / cancel | Use **Say it again**, and **Cancel** during recording | Returns to the right place; nothing counted |
| TC-12 | P0 | Fix by voice | Say a wrong answer, get the Notice, then say the corrected sentence | A new transcript to confirm; outcome is "Fixed it yourself" |
| TC-13 | P1 | Backgrounding | Start recording, switch app or lock the screen, return | A clear, neutral state: not stuck on "Listening", typing still possible |
| TC-14 | P2 | Interruption | Receive a call or notification during recording | Same as TC-13 |
| TC-15 | P0 | Offline recovery | (a) airplane mode before tapping the mic; (b) airplane mode after recording, before the transcript returns; then turn it back on | (a) "You're offline…" and typing works; (b) neutral "that took too long / couldn't turn that into text" message, nothing counted; after reconnecting, **Try speaking again** works. The on-device check keeps working offline |
| TC-16 | P1 | Slow network | Throttle to a very slow connection | A neutral timeout message within about 20 s, never a hang |
| TC-17 | P0 | Typed fallback | After each failure above | One tap to typing; the whole activity can be finished by typing alone |
| TC-18 | P1 | Reload mid-way | Reload during recording, during transcribing, and at the confirm step | Back to a sensible place (the exercise start or the typed field); nothing wrongly counted |
| TC-19 | P2 | Headset | Repeat TC-05 and TC-07 with a Bluetooth headset | Records and transcribes |
| TC-20 | P1 | VoiceOver / TalkBack | Run one full exercise with the screen reader on | Prompts and states are announced; Stop/Cancel/Continue are reachable and named |
| TC-21 | P1 | Layout | Largest text size, portrait and landscape | No horizontal scroll, buttons reachable above the keyboard |
| TC-22 | P1 | Privacy | Inspect network and storage | One audio POST per recording; no audio stored anywhere on the device; only `grammigo:guided:v1` holds activity history |

### Sentences for TC-07 (valid; say naturally)
1. I watched a film with my sister.  2. We went to the coast last summer.  3. I've been learning English for three years.  4. Yesterday evening I cooked dinner for my parents.  5. I visited my cousins in Portugal.  6. I have studied English since 2022.  7. Yes, I tried durian once and I didn't like it.  8. After work I met a friend and we played tennis.  9. No, I've never tried anything I didn't like.  10. I stayed at home and read a book.

### Sentences for TC-08 (contain the mistake: say them *as written*)
1. I have watched a film yesterday evening.  2. I have went to the gym.  3. We have visited Rome two years ago.  4. I have saw a good film.  5. I learn English since 2020.  6. I have been learning English since three years.  7. Last night I have ate pizza.  8. I am studying English since last year.  9. I have learned English for I was a child.  10. I study English since I was twelve.

## 3. Recording results

Fill in `real-device-results.template.csv` (copy it; do not edit the template): one row per device × test, with device model, OS and browser version, the first result, the evidence (transcript text, byte size, HTTP status, screenshot name) and notes. Summarise at the end:

* P0 passes and fails per device;
* TC-06 byte sizes and any 413s;
* TC-07 accuracy per speaker; TC-08 how many mistakes survived transcription;
* every case where the learner could get stuck.

## 4. What a pass does and does not mean

A clean run on real devices clears **only** the real-device blocker. It says nothing about educational validity, which is a separate, still-open blocker (educator review of content and labels, outcome weights, evaluator validation). A TC-08 result showing that mistakes are not preserved would be a *design* issue to resolve before voice is offered to learners, even if every other case passes.
