import { z } from "zod";
import { getLesson } from "@/data/lessons";
import type { Session } from "@/types/session";
import { summarizeSession } from "@/features/practice/summary";
import { scopedKey } from "@/lib/scope/storage-scope";

// Only bounded result signals travel to TTS, never transcripts or AI-authored text.
export const debriefSchema = z.object({
  independent: z.number().int().min(0).max(20),
  assisted: z.number().int().min(0).max(20),
  unverified: z.boolean(),
  tipQuestion: z.string().max(20).optional(),
  speaking: z.enum(["met", "review", "unverified", "none"]),
}).strict();
export type Debrief = z.infer<typeof debriefSchema>;
export function lessonDebrief(session: Session): Debrief {
  const summary = summarizeSession(session);
  const feedback = session.speakingChallenge?.attempts.at(-1)?.feedback;
  const questions = getLesson(session.lessonId)?.questions ?? [];
  return {
    independent: summary.independent, assisted: summary.assisted,
    unverified: summary.needsReview > 0,
    tipQuestion: session.records.find(r => r.classification && r.classification !== "correct_first_try" && questions.some(q => q.id === r.questionId))?.questionId,
    speaking: !feedback || feedback.confidence !== "high" || feedback.outcome === "unclear"
      ? session.speakingChallenge?.attempts.length ? "unverified" : "none"
      : feedback.outcome === "meets_goal" && feedback.errors.length === 0 ? "met" : "review",
  };
}
export function debriefText(lessonId: string, result: Debrief): string | null {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;
  const tip = result.tipQuestion ? lesson.questions.find(q => q.id === result.tipQuestion) : undefined;
  if (result.tipQuestion && !tip) return null;
  const parts = [`You practiced ${lesson.grammarFocus}.`];
  if (result.independent) parts.push(`You answered ${result.independent} ${result.independent === 1 ? "exercise" : "exercises"} correctly on your own.`);
  if (result.assisted) parts.push(`You also reached ${result.assisted} correct ${result.assisted === 1 ? "answer" : "answers"} after help or another try.`);
  if (result.speaking === "met") parts.push("Your speaking response also met this task’s grammar goal.");
  if (result.unverified || result.speaking === "unverified") parts.push("Unchecked responses still need review.");
  // One action, selected only when the saved results support a need for review.
  if (tip) {
    const hint = tip.hints[0]?.split(/(?<=[.!?])\s/)[0];
    parts.push(hint && hint.length <= 110 ? `For your next try: ${hint}` : `Compare your answer for ${tip.reviewTitle.toLowerCase()} with the model in your review.`);
  }
  else if (result.speaking === "review") parts.push("For your next step, revisit the grammar correction in your speaking feedback and try that sentence again.");
  parts.push("Keep practicing, amigo, one sentence at a time.");
  return parts.join(" ");
}
const memory = new Map<string, Debrief>();
/** Separate versioned device cache; no progress schema change or cloud migration. */
export function savedDebrief(session: Session): Debrief {
  const key = scopedKey(`grammigo:debrief:v1:${session.id}`);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = debriefSchema.safeParse(JSON.parse(raw));
      if (parsed.success && debriefText(session.lessonId, parsed.data)) return parsed.data;
    }
  } catch { /* completion must survive unavailable storage */ }
  const result = memory.get(key) ?? lessonDebrief(session);
  memory.set(key, result);
  try { localStorage.setItem(key, JSON.stringify(result)); } catch { /* memory fallback */ }
  return result;
}
