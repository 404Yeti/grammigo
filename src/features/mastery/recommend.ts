import type { Lesson } from "@/types/lesson";
import type { SkillEvidence } from "./evidence";

export interface Recommendation {
  skillId: string | null;
  /** "practice" when something needs work; "consolidate" when nothing did (one lesson is not mastery). */
  kind: "practice" | "consolidate";
  reason: string;
  minutes: number;
  exercises: number;
}

/**
 * Simple deterministic rule, based only on what happened in the lesson:
 *   1. The skill with the most missed answers comes first.
 *   2. Then the skill with the most answers that needed help.
 *   3. Ties go to the skill that appeared first in the lesson.
 * If nothing needed work, recommend repeating the lesson to build more evidence.
 * A single correct answer is never treated as mastery.
 */
export function recommendNext(
  evidence: SkillEvidence[],
  lesson: Lesson,
  skillTitle: (skillId: string) => string,
): Recommendation {
  const order = (skillId: string) => lesson.questions.findIndex((q) => q.skillId === skillId);
  const needsWork = evidence
    .filter((e) => e.incorrect + e.assisted > 0)
    .sort(
      (a, b) =>
        b.incorrect - a.incorrect || b.assisted - a.assisted || order(a.skillId) - order(b.skillId),
    );

  const exercises = lesson.questions.length;
  if (needsWork.length > 0) {
    const top = needsWork[0];
    return {
      skillId: top.skillId,
      kind: "practice",
      reason: `You needed help with ${skillTitle(top.skillId).toLowerCase()}. Practice it again to build independent evidence.`,
      minutes: lesson.minutes,
      exercises,
    };
  }

  return {
    skillId: null,
    kind: "consolidate",
    reason:
      "You answered everything on your own. One lesson is a good step, not proof of mastery, so a second attempt will build more evidence.",
    minutes: lesson.minutes,
    exercises,
  };
}
