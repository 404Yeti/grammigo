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
  if (id === DEFAULT_LESSON_ID) {
    if (process.env.NEXT_PUBLIC_LESSON_LISTENING === "true") {
      lesson.questions = lesson.questions.map(q => q.id !== "q1" ? q : ({
        ...q,
        prompt: "Listen to Migo. Which sentence matches the speaker’s experience of Hanoi?",
        skillLabel: "Present perfect · Listening",
        listening: { transcript: "I love travelling. Hanoi is one of my favourite cities, and I have been there twice. I hope to return someday." },
        migoLine: "Listen for the speaker’s past experience. You can replay the audio or choose the reading alternative.",
      }));
    }
    if (process.env.NEXT_PUBLIC_LESSON_SPEAKING === "true") {
      const lastConstruction = lesson.questions.findLast(q => q.type === "sentence-construction")?.id;
      lesson.questions = lesson.questions.map(q => q.id !== lastConstruction ? q : ({ ...q, allowSpeaking: true,
        prompt: "Build the sentence with word tiles, or say or type it yourself.",
      }));
    }
  }
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
