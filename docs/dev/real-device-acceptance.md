# Real-device acceptance (iPhone Safari)

**Automated tests run Chromium, Firefox, WebKit and an emulated "Mobile Safari" (WebKit with an iPhone's screen, touch and user agent). That is emulation. It does not run iOS, so it can miss real-iPhone behaviour: storage eviction, the back/forward cache, the keyboard, safe areas, downloads, cookie rules for OAuth redirects, Private Browsing, Low Power Mode. Physical-device acceptance has NOT been done. Do not claim it until the boxes below are ticked by a person holding a real iPhone.**

Needed: a real iPhone on current iOS Safari (and, if possible, one one-or-two versions back), the staging/preview deployment with accounts on and the real Google OAuth client (only after the owner approves Phase 7), an invitation, and a second device. Record: tester, device model, iOS version, date, build commit. Tick only what you saw.

## A. Anonymous learning (no account)
- [ ] Home, Library, a full lesson, Review and Complete render without clipping; nothing hides under the notch, home bar or keyboard; text sizes are readable.
- [ ] Answer by tapping and by typing; the keyboard does not cover the field or the Continue button; Return/Go submits.
- [ ] Rotate to landscape and back mid-lesson: nothing breaks or resets.
- [ ] Close Safari from the app switcher mid-lesson, reopen: "Continue Lesson" resumes where you were.
- [ ] Airplane mode mid-lesson: the lesson and Guided Correction carry on; no error wall.
- [ ] Guided Correction: type an answer; try the microphone (permission prompt text is clear; denying it still allows typing).
- [ ] Private Browsing: the app explains if progress can't be kept, rather than failing silently.

## B. Joining and signing in (real Google)
- [ ] Open an invitation link on the iPhone (from Messages and from Mail): the code appears, the address bar shows no code afterwards.
- [ ] Join: the 18+ box, Google account chooser, consent, return to Grammigo signed in. No loop, no blank page, no "state" error.
- [ ] Do it from a link opened inside another app's in-app browser (e.g. Messages/Mail/Instagram): note what happens (Google may refuse embedded browsers; record the message and what the learner should do).
- [ ] Sign out, sign in again (no invitation): lands on the dashboard. Cancel at Google: a calm message.
- [ ] Kill Safari and reopen after an hour: still signed in (or a clear sign-in prompt, never a half state).
- [ ] Safari setting "Prevent Cross-Site Tracking" on (default): sign-in still completes.

## C. Saving and devices
- [ ] Turn saving on; finish a lesson; the chip reads "Saved to your account" only after it is saved. Lock the phone straight after a lesson, open on the second device: the lesson is there.
- [ ] Airplane mode, finish a lesson, reconnect: it saves by itself; status wording is honest throughout.
- [ ] Two devices, same account, different lessons: both end with both.
- [ ] Switch accounts on the same phone (A signs out, B signs in): B sees nothing of A's progress; the guest's progress is still there as a guest.

## D. Your data and deletion
- [ ] "Download my data": the file saves (Files app / share sheet), opens, and contains only this account.
- [ ] "Download a copy of my progress" (device copy) works the same way.
- [ ] Delete: the confirm screen is usable with the keyboard; if the sign-in is older than 10 minutes you are asked to sign in with Google again and return to the delete screen; after deleting you land on the goodbye page, are signed out, and the second device is signed out too.
- [ ] Reopen the old invitation link or sign in with the same Google account: it does NOT restore the account.

## E. Accessibility on device
- [ ] VoiceOver: main flows are announced sensibly (errors announced, buttons labelled, dialogs not trapping).
- [ ] Larger text (Settings → Display → Text Size) and Bold Text: nothing overflows.
- [ ] Reduce Motion on: no problematic animation.

## Sign-off
Tester ______  Device ______  iOS ______  Commit ______  Date ______  Result: PASS / FAIL (list failures as Linear issues).
