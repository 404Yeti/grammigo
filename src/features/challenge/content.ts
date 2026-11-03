import { getCurriculumSkill } from "@/curriculum";
import type { Question } from "@/types/lesson";

export const CHALLENGE_ID = "final-speaking";

/** Select the existing authored production task at the lesson's own CEFR level. */
export function speakingChallenge(lessonId: string): Question | null {
  const skill = getCurriculumSkill(lessonId);
  const task = skill?.questions.find(q => q.type === "short-writing");
  if (!skill || !task) return null;
  return {
    ...task,
    id: CHALLENGE_ID,
    type: "speaking",
    strategy: "ai-writing",
    prompt: `Use new examples. ${task.prompt.replace(/\bwrite\b/gi, "Say")}`,
    writingCriteria: `${task.writingCriteria ?? task.displayAnswer} This is a ${skill.cefr} spoken response with learner-confirmed transcription. Assess only the target grammar, never accent, pronunciation, punctuation or transcription accuracy. Briefly identify what is correct and one specific improvement if needed. If the text is ambiguous or may be misheard, return unclear rather than a grammatical error; ask the learner to check the transcript.`,
  };
}
