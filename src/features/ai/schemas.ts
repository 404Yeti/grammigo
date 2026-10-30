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

/**
 * Limits applied AFTER validation by clamping (see service.ts). The schemas below are strict about
 * types, required fields and unknown keys, but deliberately do not reject over-long lists or
 * strings: a model that lists too many skills should be trimmed, not discarded.
 */
export const AI_LIMITS = {
  summary: 280,
  goalLabel: 80,
  goals: 5,
  candidates: 6,
  unclearReason: 200,
  errors: 5,
  original: 200,
  correction: 200,
  errorExplanation: 300,
  suggestedCorrection: 400,
  explanation: 500,
  example: 240,
} as const;

/** What the model must return when interpreting what a learner wants to improve. */
export const goalExtractionSchema = z
  .object({
    summary: z.string(),
    goals: z.array(z.object({ label: z.string(), skillIds: z.array(z.string()) }).strict()),
    candidateSkillIds: z.array(z.string()),
    unclearReason: z.string().nullable(),
  })
  .strict();
export type GoalExtraction = z.infer<typeof goalExtractionSchema>;

export const writingFeedbackSchema = z
  .object({
    outcome: z.enum(["meets_goal", "needs_work", "unclear"]),
    confidence: z.enum(["low", "medium", "high"]),
    errors: z.array(z.object({ original: z.string(), correction: z.string(), explanation: z.string() }).strict()),
    suggestedCorrection: z.string().nullable(),
    explanation: z.string(),
    example: z.string().nullable(),
    assessedSkillIds: z.array(z.string()),
  })
  .strict();
export type WritingFeedback = z.infer<typeof writingFeedbackSchema>;

/** Trims to a maximum length without ever throwing. */
export const clamp = (text: string, max: number): string => text.trim().slice(0, max);

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
