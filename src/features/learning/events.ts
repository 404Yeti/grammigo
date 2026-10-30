import type { Lesson } from "@/types/lesson";
import type { Session } from "@/types/session";
import type { EvidenceEvent } from "./mastery";

/**
 * Turns saved lesson sessions into evidence events, one per resolved question.
 * Works for v0.1 sessions too: they use the same lesson id and question ids.
 * Answers saved for review (unverified writing) and unfinished questions are not evidence.
 */
export function lessonEvents(
  sessions: readonly Session[],
  lessonOf: (lessonId: string) => Lesson | undefined,
): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];
  for (const session of sessions) {
    const lesson = lessonOf(session.lessonId);
    if (!lesson) continue; // lesson no longer in the catalog: keep the history, skip the evidence
    session.records.forEach((record, i) => {
      const question = lesson.questions[i];
      if (!question || record.classification === null || record.resolution === "needs_review") return;
      const lastAttempt = record.attempts[record.attempts.length - 1];
      events.push({
        skillId: session.lessonId,
        outcome: record.classification,
        source: "lesson",
        groupId: session.id,
        questionKey: `${session.lessonId}/${question.id}`,
        at: lastAttempt?.at ?? session.updatedAt,
      });
    });
  }
  return events;
}
