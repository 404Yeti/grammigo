import type { Lesson, Question } from "@/types/lesson";
import type { QuestionRecord, Session, StoredWritingFeedback } from "@/types/session";
import type { ReviewDetail, ReviewResult } from "@/components/lesson/ReviewCard";

export interface ReviewItem {
  number: number;
  questionId: string;
  title: string;
  result: ReviewResult;
  details: ReviewDetail[];
  why: string;
}

function displayAnswer(question: Question, answer: string): string {
  const option = question.options?.find((o) => o.id === answer);
  return option ? option.label : answer;
}

export function describeHelp(record: Pick<QuestionRecord, "hintsUsed" | "attempts">): string {
  const hints = record.hintsUsed;
  const retries = Math.max(0, record.attempts.length - 1);
  if (hints === 0 && retries === 0) return "None";
  const parts: string[] = [];
  if (hints > 0) parts.push(`${hints} ${hints === 1 ? "hint" : "hints"}`);
  if (retries > 0) parts.push(`${retries} ${retries === 1 ? "retry" : "retries"}`);
  return parts.join(", then ");
}

/** Builds review content only from the recorded attempt history. Nothing is hard-coded. */
export function buildReviewItems(
  session: Session,
  lesson: Lesson,
  feedbackFor: (questionId: string) => StoredWritingFeedback | undefined = () => undefined,
): ReviewItem[] {
  return lesson.questions.flatMap((question, index) => {
    const record = session.records[index];
    if (!record || record.resolution === "open") return [];

    const result: ReviewResult =
      record.resolution === "needs_review" ? "needs_review" : (record.classification ?? "incorrect");

    const first = record.attempts[0]?.answer ?? "";
    const final = record.finalAnswer ?? first;
    const details: ReviewDetail[] = [{ label: "Your answer", value: displayAnswer(question, first) }];
    if (final !== first && record.resolution === "correct") {
      details.push({ label: "Final answer", value: displayAnswer(question, final) });
    }
    details.push({
      label: record.resolution === "needs_review" ? "What we look for" : "Correct answer",
      value: question.displayAnswer,
      tone: record.resolution === "needs_review" ? undefined : "success",
    });
    details.push({ label: "Help used", value: describeHelp(record) });
    const fb = feedbackFor(question.id);
    if (fb?.status === "ready" && fb.explanation) {
      details.push({ label: "Feedback", value: fb.explanation });
      if (fb.suggestedCorrection) details.push({ label: "A corrected version", value: fb.suggestedCorrection });
    }

    return [
      {
        number: index + 1,
        questionId: question.id,
        title: question.reviewTitle,
        result,
        details,
        why: question.explanation,
      },
    ];
  });
}
