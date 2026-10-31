import { getGuidedItem, renderLadder } from "@/curriculum/guided";
import type { ClarifyKind, ExercisePhase, GuidedExercise, VoiceIssue } from "@/types/guided";

/**
 * Authored wording for the states that are NOT a verdict. Everything here stays on the target
 * skill (tense choice and form) or on being able to follow the answer. Nothing blames the learner,
 * and nothing here is a mistake report: they are all neutral or optional. Flagged for educator review.
 */
export const NEUTRAL = {
  notAnAttempt: "I couldn’t find a sentence to look at. Try writing or saying a full sentence.",
  unverified: "I can’t judge this one for sure. That’s on me, not you. Compare your sentence with one way to say it, and decide if yours says the same thing.",
  unverifiedNoSecondOpinion: "Second opinions aren’t available right now, so I’ll leave this one unjudged. Nothing is counted against you.",
  clarify: {
    incomplete: "Could you say a little more? A full sentence helps me follow.",
    off_prompt: "I’m not sure that answers the question. Want to try again in your own words?",
    grammar_guidance: "Take another look at the verb tenses in your sentence. Does each one fit the time you’re talking about?",
  } satisfies Record<ClarifyKind, string>,
  offerShowMe: "You’ve given this a good go. I’ll show you one way to say it, and why it works.",
} as const;

export const VOICE_MESSAGES: Record<VoiceIssue, string> = {
  permission_denied: "The microphone is off for Grammigo. You can allow it in your browser settings, or type instead.",
  unsupported: "This browser can’t record audio. You can do everything by typing.",
  no_speech: "I didn’t hear anything. Try again, or type it.",
  failed: "I couldn’t turn that into text. That’s not on you. Try once more, or type it.",
  timeout: "That took too long. Try once more, or type it.",
  offline: "You’re offline, so voice isn’t available right now. Typing still works.",
};

const FRAME_REASON = {
  finished: "A finished time like “yesterday evening” goes with the past simple. The present perfect connects the past to now.",
  unfinished: "“For” and “since” go with the present perfect when something started in the past and continues now.",
  experience: "For life experiences with no finished time we use the present perfect. Add a time and we use the past simple.",
} as const;

export interface ExerciseView {
  question: string;
  speakable: string;
  phase: ExercisePhase;
  /** Authored ladder text that is currently visible, in order. */
  ladder: { notice: string | null; hint1: string | null; hint2: string | null };
  /** Neutral, ungraded wording for clarifying, unverified, not-an-attempt and offer-show-me states. */
  neutral: string | null;
  voiceMessage: string | null;
  retriesLeft: number;
  canRequestHint: boolean;
  /** True from the first screen to the end: Show me is never gated. */
  canShowMe: boolean;
  /** For Show me and the reason step. */
  modelAnswer: string;
  reason: string | null;
}

export function viewExercise(ex: GuidedExercise): ExerciseView {
  const item = getGuidedItem(ex.itemId);
  if (!item) throw new Error(`Unknown guided item: ${ex.itemId}`);
  const ladder = ex.category ? renderLadder(ex.category, ex.ladder ?? {}) : null;
  const limit = ex.kind === "transfer" ? 1 : 3;

  let neutral: string | null = null;
  if (ex.notice === "not_an_attempt") neutral = NEUTRAL.notAnAttempt;
  else if (ex.phase === "clarifying" && ex.clarify) {
    neutral = ex.clarify.kind === "grammar_guidance" && ex.clarify.suspected ? renderLadder(ex.clarify.suspected).notice : NEUTRAL.clarify[ex.clarify.kind];
  } else if (ex.phase === "unverified") {
    neutral = ex.unverifiedReason?.startsWith("opinion_") || ex.unverifiedReason === "second_opinion_unavailable" ? `${NEUTRAL.unverified} ${NEUTRAL.unverifiedNoSecondOpinion}` : NEUTRAL.unverified;
  } else if (ex.phase === "offer_show_me") neutral = NEUTRAL.offerShowMe;

  return {
    question: item.question,
    speakable: item.speakable,
    phase: ex.phase,
    ladder: {
      notice: ladder && ex.rung >= 1 ? ladder.notice : null,
      hint1: ladder && ex.rung >= 2 && ex.kind === "main" ? ladder.hint2 : null,
      hint2: ladder && ex.rung >= 3 && ex.kind === "main" ? ladder.hint3 : null,
    },
    neutral,
    voiceMessage: ex.voiceIssue ? VOICE_MESSAGES[ex.voiceIssue] : null,
    retriesLeft: Math.max(0, limit - ex.retriesUsed),
    canRequestHint: ex.kind === "main" && ex.phase === "repairing" && ex.rung >= 1 && ex.rung < 3,
    canShowMe: ex.phase !== "resolved",
    modelAnswer: item.modelAnswers[0],
    reason: ladder ? ladder.reason : FRAME_REASON[item.frame],
  };
}
