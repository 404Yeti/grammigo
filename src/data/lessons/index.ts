import type { Lesson } from "@/types/lesson";
import { getCurriculumSkill, listSkills, toLesson } from "@/curriculum";

/** The lesson the v0.1 dashboard recommended first; kept for saved-data compatibility. */
export const DEFAULT_LESSON_ID = "present-perfect-vs-past-simple";

const CACHE = new Map<string, Lesson>();

/** Lessons are derived from the validated curriculum; ids match saved sessions. */
export function getLesson(id: string): Lesson | undefined {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const skill = getCurriculumSkill(id);
  if (!skill) return undefined;
  const lesson = toLesson(skill);
  // Same objective, question IDs and record count: existing sessions remain compatible.
  if (process.env.NEXT_PUBLIC_LESSON_SPEAKING === "true" && id === DEFAULT_LESSON_ID) {
    lesson.questions = lesson.questions.map((q) => q.id !== "q8" ? q : ({
      ...q, type: "speaking", skillLabel: "Independent production · Speak or type",
      prompt: "Say or write two sentences: one about something you have done this week, and one about something you did yesterday.",
      praise: "You used both tenses!",
    }));
  }
  CACHE.set(id, lesson);
  return lesson;
}

export function listLessons(): readonly Lesson[] {
  return listSkills().map((s) => getLesson(s.id)!);
}
