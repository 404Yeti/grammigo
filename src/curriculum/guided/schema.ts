import { z } from "zod";
import { FRAMES, TARGET_CATEGORIES } from "@/features/guided/evaluator/types";

/** Authored content for Guided Correction. Kept apart from lessons: it never changes a lesson or its progress. */
export const GUIDED_SKILL_ID = "present-perfect-vs-past-simple";

const text = z.string().trim().min(1);

/**
 * The authored ladder for one kind of mistake. Placeholders (filled from the learner's own sentence):
 * {marker} their time expression, {aux} have/has, {verb} their verb, {participle} the form to use,
 * {exBase} {exPast} {exPart} a different, stock verb for rung-3 examples.
 */
export const guidedCategorySchema = z.object({
  id: z.enum(TARGET_CATEGORIES),
  label: text,
  /** Rung 1: free. Points at the area, never at the answer. */
  notice: text,
  /** Rung 2: a hint. Names the rule without the target form. */
  hint2: text,
  /** Rung 3: a hint. Shows the pattern with a different verb. */
  hint3: text,
  /** UNDERSTAND: at most two short sentences. Shown after the fix, so it may state the form. */
  reason: text,
});
export type GuidedCategory = z.infer<typeof guidedCategorySchema>;

export const guidedItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  skillId: z.literal(GUIDED_SKILL_ID),
  kind: z.enum(["main", "transfer"]),
  frame: z.enum(FRAMES),
  /** One line of context, shown on the "Chat" card. */
  situation: text,
  /** The question, written so a person would really ask it. The learner answers in their own words. */
  question: text,
  /** The same question as Migo would say it (for text-to-speech later). */
  speakable: text,
  answerHint: text,
  /** Natural answers for "Show me". They must all be judged correct by the evaluator. */
  modelAnswers: z.array(text).min(2),
  /** The only categories that may produce an "incorrect" verdict for this item. */
  categories: z.array(z.enum(TARGET_CATEGORIES)).min(1),
  /** Realistic learner mistakes per category, used to keep the content and the evaluator in step. */
  wrongSamples: z.partialRecord(z.enum(TARGET_CATEGORIES), z.array(text)),
  contentStatus: z.enum(["needs-educator-review", "educator-approved"]),
});
export type GuidedItem = z.infer<typeof guidedItemSchema>;

export const guidedPilotSchema = z.object({
  skillId: z.literal(GUIDED_SKILL_ID),
  categories: z.array(guidedCategorySchema).min(1),
  items: z.array(guidedItemSchema).min(2),
  /** Which item follows the main one, by what happened (the app picks; the evaluator never does). */
  transferPlan: z.object({
    afterError: z.array(z.string()).min(1),
    afterFirstTry: z.array(z.string()).min(1),
    alternate: z.array(z.string()),
  }),
});
export type GuidedPilot = z.infer<typeof guidedPilotSchema>;
