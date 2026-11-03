import { CHALLENGE_ID, speakingChallenge } from "@/features/challenge/content";
import { z } from "zod";
import { getLesson } from "@/data/lessons";

export const speechRequestSchema = z.object({
  lessonId: z.string().min(1).max(80),
  questionId: z.string().min(1).max(20),
  kind: z.enum(["instruction", "encouragement", "correction", "hint", "listening", "positive", "supportive", "celebration"]),
  hintIndex: z.number().int().min(0).max(2).optional(),
}).strict();
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export const MAX_SPEECH_CHARACTERS = 320;

/** Only authored, public lesson copy can be synthesized or cached. No arbitrary learner text. */
export function speechText(input: SpeechRequest): string | null {
  const lesson = getLesson(input.lessonId);
  if (!lesson) return null;
  if (input.kind === "celebration") return input.questionId === "completion" ? "You did it, amigo! Another lesson complete. Keep it up!" : null;
  const q = input.questionId === CHALLENGE_ID ? speakingChallenge(lesson.id) : lesson.questions.find(question => question.id === input.questionId);
  if (!q) return null;
  let text: string | undefined;
  switch (input.kind) {
    case "positive": text = "Nice work! That’s right."; break;
    case "supportive": {
      const hint = q.hints[0]?.replace(/\s+/g, " ").trim();
      text = `Good try. ${hint && hint.length <= 160 ? hint : "Check the grammar pattern, then try again. You can do this."}`;
      break;
    }
    case "listening": text = q.listening?.transcript; break;
    case "instruction": text = q.prompt; break;
    case "encouragement": text = `${q.praise} ${q.praiseBody}`; break;
    case "correction": text = `${q.explanation} ${q.displayAnswer}`; break;
    case "hint": text = q.hints[input.hintIndex ?? 0]; break;
  }
  if (!text) return null;
  const readable = text.replace(/_{2,}/g, " blank ").replace(/\s+/g, " ").trim();
  if (readable.length <= MAX_SPEECH_CHARACTERS) return readable;
  const limited = readable.slice(0, MAX_SPEECH_CHARACTERS);
  const end = Math.max(limited.lastIndexOf(". "), limited.lastIndexOf("? "), limited.lastIndexOf("! "));
  return end > 60 ? limited.slice(0, end + 1) : limited.slice(0, limited.lastIndexOf(" "));
}
