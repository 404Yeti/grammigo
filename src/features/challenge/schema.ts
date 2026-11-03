import { z } from "zod";
import { writingFeedbackSchema } from "@/features/ai/schemas";

export const challengeSchema = z.object({
  status: z.enum(["active", "finished", "skipped"]),
  draft: z.string().max(500),
  retryUsed: z.boolean(),
  attempts: z.array(z.object({
    text: z.string().max(500),
    at: z.number().finite(),
    feedback: writingFeedbackSchema.nullable(),
  })).max(2),
});
export type SpeakingChallenge = z.infer<typeof challengeSchema>;
export const newChallenge = (): SpeakingChallenge => ({ status: "active", draft: "", retryUsed: false, attempts: [] });
