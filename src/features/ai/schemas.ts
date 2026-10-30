import { z } from "zod";

/* ------------------------------------------------------------- requests */

export const goalsRequestSchema = z.object({ text: z.string().trim().min(2).max(600) }).strict();

export const writingRequestSchema = z
  .object({
    skillId: z.string().min(1).max(80),
    questionId: z.string().min(1).max(20),
    text: z.string().trim().min(3).max(600),
  })
  .strict();

/* ------------------------------------------------------------ responses */

/** What the model must return when interpreting what a learner wants to improve. */
export const goalExtractionSchema = z
  .object({
    summary: z.string().max(280),
    goals: z
      .array(z.object({ label: z.string().min(1).max(80), skillIds: z.array(z.string()).max(4) }).strict())
      .max(5),
    candidateSkillIds: z.array(z.string()).max(6),
    unclearReason: z.string().max(200).nullable(),
  })
  .strict();
export type GoalExtraction = z.infer<typeof goalExtractionSchema>;

export const writingFeedbackSchema = z
  .object({
    outcome: z.enum(["meets_goal", "needs_work", "unclear"]),
    confidence: z.enum(["low", "medium", "high"]),
    errors: z
      .array(
        z
          .object({
            original: z.string().max(200),
            correction: z.string().max(200),
            explanation: z.string().max(300),
          })
          .strict(),
      )
      .max(5),
    suggestedCorrection: z.string().max(400).nullable(),
    explanation: z.string().max(500),
    example: z.string().max(240).nullable(),
    assessedSkillIds: z.array(z.string()).max(3),
  })
  .strict();
export type WritingFeedback = z.infer<typeof writingFeedbackSchema>;

/* ------------------------------------------- OpenAI strict JSON schemas */

const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;

export function goalJsonSchema(allowedSkillIds: readonly string[]) {
  const id = { type: "string", enum: [...allowedSkillIds] } as const;
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "goals", "candidateSkillIds", "unclearReason"],
    properties: {
      summary: str,
      goals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "skillIds"],
          properties: { label: str, skillIds: { type: "array", items: id } },
        },
      },
      candidateSkillIds: { type: "array", items: id },
      unclearReason: nullableStr,
    },
  } as const;
}

export function writingJsonSchema(allowedSkillIds: readonly string[]) {
  const id = { type: "string", enum: [...allowedSkillIds] } as const;
  return {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "confidence", "errors", "suggestedCorrection", "explanation", "example", "assessedSkillIds"],
    properties: {
      outcome: { type: "string", enum: ["meets_goal", "needs_work", "unclear"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      errors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["original", "correction", "explanation"],
          properties: { original: str, correction: str, explanation: str },
        },
      },
      suggestedCorrection: nullableStr,
      explanation: str,
      example: nullableStr,
      assessedSkillIds: { type: "array", items: id },
    },
  } as const;
}
