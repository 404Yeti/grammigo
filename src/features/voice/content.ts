import { z } from "zod";
import { getLesson } from "@/data/lessons";

export const speechRequestSchema = z.object({
  lessonId: z.string().min(1).max(80),
  questionId: z.string().min(1).max(20),
  kind: z.enum(["instruction", "encouragement", "correction", "hint"]),
  hintIndex: z.number().int().min(0).max(2).optional(),
}).strict();
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export const MAX_SPEECH_CHARACTERS = 320;

/** Only authored, public lesson copy can be synthesized or cached. No arbitrary learner text. */
export function speechText(input: SpeechRequest): string | null {
  const q = getLesson(input.lessonId)?.questions.find(question => question.id === input.questionId);
  if (!q) return null;
  let text: string | undefined;
  switch (input.kind) {
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
