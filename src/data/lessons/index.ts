import type { Lesson } from "@/types/lesson";
import { presentPerfectVsPastSimple } from "./present-perfect-vs-past-simple";

const LESSONS: Lesson[] = [presentPerfectVsPastSimple];

/** The lesson the dashboard recommends first. */
export const DEFAULT_LESSON_ID = presentPerfectVsPastSimple.id;

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

export function listLessons(): readonly Lesson[] {
  return LESSONS;
}
