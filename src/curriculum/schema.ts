import { z } from "zod";
import type { Question } from "@/types/lesson";

/** Bump when the curriculum data shape changes. */
export const CURRICULUM_SCHEMA_VERSION = 1 as const;

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const EXERCISE_TYPES = [
  "multiple-choice",
  "fill-blank",
  "multiple-choice-context",
  "sentence-correction",
  "sentence-construction",
  "contextual-verb",
  "sentence-transformation",
  "short-writing",
] as const;

export const EVALUATION_STRATEGIES = [
  "exact-choice",
  "normalized-text",
  "ordered-words",
  "limited-rubric",
  "ai-writing",
] as const;

/** Compact, quick-to-answer closed types eligible for the diagnostic (known answers, no AI). */
export const DIAGNOSTIC_TYPES = [
  "multiple-choice",
  "fill-blank",
  "multiple-choice-context",
  "contextual-verb",
] as const;

export const LESSON_EXERCISE_COUNT = 8;

const kebab = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase kebab-case");
const text = z.string().trim().min(1);

export const questionSchema = z.object({
  id: kebab,
  reviewTitle: text,
  skillId: z.string().min(1),
  skillLabel: text,
  type: z.enum(EXERCISE_TYPES),
  evidence: z.enum(["recognition", "construction", "production"]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  strategy: z.enum(EVALUATION_STRATEGIES),
  prompt: text,
  source: z.string().optional(),
  options: z.array(z.object({ id: text, label: text })).min(2).max(6).optional(),
  tiles: z.array(text).min(3).optional(),
  acceptedAnswers: z.array(text),
  displayAnswer: text,
  helper: z.string().optional(),
  placeholder: z.string().optional(),
  hints: z.array(text).min(1).max(3),
  explanation: text,
  migoLine: text,
  praise: text,
  praiseBody: text,
  nudge: z.object({ title: text, body: text }),
  misconceptions: z.array(z.object({ answers: z.array(text).min(1), message: text })).optional(),
  maxAttempts: z.number().int().min(1).max(5),
  writingCriteria: z.string().optional(),
}) satisfies z.ZodType<Question>;

export const REVIEW_STATUSES = ["needs-educator-review", "educator-approved"] as const;

export const skillSchema = z.object({
  /** Stable. Also the lesson id and the id used in saved sessions. Never rename. */
  id: kebab,
  slug: kebab,
  title: text,
  cefr: z.enum(CEFR_LEVELS),
  /** Why the skill sits at this level: an editorial judgement, not a validated placement. */
  mappingRationale: z.string().trim().min(30),
  topic: text,
  subtopic: text,
  objectives: z.array(text).min(2).max(6),
  prerequisites: z.array(kebab),
  difficulty: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().int().min(1).max(30),
  explanation: z.object({
    summary: text,
    examples: z.array(z.object({ text, note: z.string().optional() })).min(2),
  }),
  commonMistakes: z.array(z.object({ mistake: text, correction: text, why: text })).min(1),
  /** Migo's line on the lesson introduction. */
  intro: text,
  homeReason: text,
  /** Lower-case words/phrases matching a learner's own wording to this skill (offline fallback). */
  keywords: z.array(text).min(2),
  /** Review-screen copy. */
  review: z.object({ strengthText: text, practiceText: text }),
  contentStatus: z.enum(REVIEW_STATUSES),
  questions: z.array(questionSchema).length(LESSON_EXERCISE_COUNT),
});

export const curriculumSchema = z.object({
  schemaVersion: z.literal(CURRICULUM_SCHEMA_VERSION),
  skills: z.array(skillSchema).min(1),
});

export type CurriculumSkill = z.infer<typeof skillSchema>;
export type Curriculum = z.infer<typeof curriculumSchema>;
