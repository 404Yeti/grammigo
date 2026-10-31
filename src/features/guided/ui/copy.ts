import type { GuidedOutcomeKind } from "@/types/guided";

/**
 * Wording the Guided Correction screens add on top of the cycle messages (cycle/messages.ts).
 * All of it is PROVISIONAL and is exported for educator review (docs/guided-correction/).
 * Rules: calm, never blames the learner, stays on the target skill, never says "wrong" for anything
 * that is not a deterministic mistake.
 */
export const OUTCOME_LABEL: Record<GuidedOutcomeKind, string> = {
  first_try: "First try",
  self_corrected: "Fixed it yourself",
  hint_assisted: "Fixed with a hint",
  shown: "Shown by Migo",
  unverified: "Not checked · not counted",
};

export const RESOLVED = {
  first_try: { title: "That fits.", body: "Your tenses match what the question asks.", migo: "Nice and natural." },
  self_corrected: { title: "You spotted it.", body: "You changed your sentence and it fits now. Spotting it is the skill.", migo: "Spotting it yourself is the hard part." },
  hint_assisted: { title: "Yes, that fits.", body: "The hint helped you get there.", migo: "Next time you may not need it." },
  shown: { title: "One way to say it", body: "", migo: "A very common mix-up. You’ll see it again soon." },
  unverified: { title: "I can’t judge this one for sure", body: "", migo: "Different isn’t the same as wrong." },
} as const;

export const COPY = {
  tag: "Past simple vs present perfect",
  fixIt: "Fix it",
  newSituation: "New situation",
  oneSentence: "One sentence is enough.",
  editThenTry: "Edit it, then try again.",
  attemptMigo: "Take your time. One sentence is plenty.",
  repairMigo: ["I think you can spot it.", "No rush. A small nudge, then try again.", "You’re getting closer."],
  checking: { title: "Taking a closer look…", body: "This one needs a careful check. You can keep editing, or skip the check. Nothing is counted against you.", migo: "Back in a moment." },
  offline: "You’re offline. Typing and checking still work on this device. Second opinions are paused.",
  voiceUnavailableOnline: "Voice needs the online helper, which isn’t on right now. Typing works exactly the same.",
  explainer: { label: "Before you speak", title: "Allow the microphone?", body: "Grammigo listens only while you’re recording, and the recording isn’t kept. Your browser will ask for permission next." },
  speakHelp: { idle: "Tap to speak", limit: "Up to 30 seconds", migo: "Say it naturally. You’ll check the words before I look at the grammar." },
  listening: "Listening…",
  transcribing: "Turning your voice into text…",
  confirm: { title: "Did I hear you right?", fixTitle: "Did I hear your new sentence?", body: "Check the words and fix anything that’s off. I haven’t looked at the grammar yet.", hint: "Edit it if needed, or say it again.", migo: "Only you know what you meant to say." },
  unsure: { label: "One word is unsure", unsureMany: "A few words are unsure", body: "Please check the highlighted words and change them if I got them wrong. I won’t treat it as a mistake until you confirm." },
  micHelp: { label: "To turn it on", title: "Allow the microphone for Grammigo", body: "Open your browser’s site settings, allow the microphone, then try again. Typing works just as well." },
  transferIntro: { label: "New situation", title: "Now try it somewhere new", body: "Same idea, different words. You get one try, plus one nudge if you need it. No hints this time." },
  transferNudgeMigo: "One try, plus a nudge if you need it.",
  notCounted: { label: "Not counted", chip: "Not checked", mine: "Your sentence", model: "One way to say it" },
  summary: {
    title: "Nice work today",
    howLabel: "How this was counted",
    how: "We track four kinds of outcome: first try, fixed it yourself, fixed with a hint, and shown by Migo. These results are kept separate from your lesson progress while we check what they mean.",
    notCountedLabel: "One answer not counted",
    notCounted: "I couldn’t check one sentence for sure, so it isn’t counted. Nothing was held against you.",
  },
  exit: { title: "Leave Fix it with Migo?", description: "Your place is saved. You can pick up where you left off.", continueLabel: "Keep going", exitLabel: "Save & Exit" },
} as const;

export const STEPS = ["Try", "Notice", "Fix", "Why", "Apply"] as const;
