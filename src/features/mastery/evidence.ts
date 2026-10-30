import type { EvidenceKind, Lesson } from "@/types/lesson";
import type { Session } from "@/types/session";

/** Raw counts of what happened for one skill in one session. No scores, no percentages. */
export interface SkillEvidence {
  skillId: string;
  independent: number;
  assisted: number;
  incorrect: number;
  needsReview: number;
  /** Independent successes per evidence kind (the foundation for adaptive logic later). */
  independentByKind: Record<EvidenceKind, number>;
  /** Questions that needed a hint or retry, or were missed: candidates for repeat practice. */
  repeatedErrorQuestionIds: string[];
}

export function collectEvidence(session: Session, lesson: Lesson): SkillEvidence[] {
  const bySkill = new Map<string, SkillEvidence>();

  lesson.questions.forEach((question, index) => {
    const record = session.records[index];
    if (!record || record.resolution === "open") return;

    let entry = bySkill.get(question.skillId);
    if (!entry) {
      entry = {
        skillId: question.skillId,
        independent: 0,
        assisted: 0,
        incorrect: 0,
        needsReview: 0,
        independentByKind: { recognition: 0, construction: 0, production: 0 },
        repeatedErrorQuestionIds: [],
      };
      bySkill.set(question.skillId, entry);
    }

    if (record.resolution === "needs_review") {
      entry.needsReview += 1;
    } else if (record.classification === "correct_first_try") {
      entry.independent += 1;
      entry.independentByKind[question.evidence] += 1;
    } else if (record.classification === "incorrect") {
      entry.incorrect += 1;
      entry.repeatedErrorQuestionIds.push(question.id);
    } else {
      entry.assisted += 1;
      entry.repeatedErrorQuestionIds.push(question.id);
    }
  });

  return [...bySkill.values()];
}
