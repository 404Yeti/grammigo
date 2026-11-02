import { z } from "zod";

/** Separate optional observation: never a closed-item outcome or CEFR/mastery score. */
export const optionalSpeakingSchema = z.discriminatedUnion("status", [
  z.object({ version: z.literal(1), status: z.literal("skipped"), at: z.number().finite().nonnegative() }).strict(),
  z.object({
    version: z.literal(1), status: z.literal("answered"), at: z.number().finite().nonnegative(),
    questionId: z.literal("favorite-place-present-simple"), answer: z.string().trim().min(1).max(500),
    observation: z.enum(["pattern_seen", "needs_work", "unverified"]),
  }).strict(),
]);
export type OptionalSpeaking = z.infer<typeof optionalSpeakingSchema>;

export function observeFavoritePlace(answer: string): { observation: "pattern_seen" | "needs_work" | "unverified"; message: string } {
  const text = answer.trim().replace(/’/g, "'");
  if (/^my favou?rite place\s+(are|have)\b/i.test(text)) return {
    observation: "needs_work", message: "“My favorite place” is singular. Try “My favorite place is…” or “My favorite place has…”. You can retry or continue; this optional sample does not change your quick-check result.",
  };
  if (/^my favou?rite place\s+(is|has)\s+\S/i.test(text)) return {
    observation: "pattern_seen", message: "Your sample uses “is” or “has” with the singular subject “my favorite place”. This is a limited observation, not a grade for your whole sentence or your speaking level.",
  };
  return { observation: "unverified", message: "Thanks for the sample. Migo can’t reliably check this optional answer with its local rules. It won’t change your quick-check result." };
}
