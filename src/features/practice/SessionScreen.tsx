"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { getLesson } from "@/data/lessons";
import { ExerciseView } from "@/components/exercises/ExerciseView";
import { FeedbackPanel, type FeedbackKind } from "@/components/feedback/FeedbackPanel";
import { HintCard } from "@/components/feedback/HintCard";
import { ExitDialog } from "@/components/lesson/ExitDialog";
import { LessonHeader } from "@/components/lesson/LessonHeader";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import type { AnswerState } from "@/components/ui/AnswerOption";
import { Button } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { practiceActions } from "./actions";
import { getActiveSession } from "./selectors";
import { canRetry, currentQuestion, currentRecord, isLastQuestion } from "./session";
import { usePracticeState } from "./use-practice-state";

function renderPrompt(prompt: string) {
  const parts = prompt.split("___");
  return parts.flatMap((part, i) =>
    i < parts.length - 1
      ? [part, <span key={i} role="img" aria-label="blank">____</span>]
      : [part],
  );
}

export function SessionScreen({ lessonId }: { lessonId: string }) {
  const lesson = getLesson(lessonId)!;
  const router = useRouter();
  const state = usePracticeState();
  const session = state ? getActiveSession(state, lessonId) : null;

  const [error, setError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const leaving = useRef(false);

  const promptRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  const sessionId = session?.id;
  const index = session?.currentIndex;
  const phase = session?.phase;

  // No active attempt (fresh visit or stale link): back to the lesson introduction.
  useEffect(() => {
    if (state && !session && !leaving.current) router.replace(`/practice/${lessonId}`);
  }, [state, session, router, lessonId]);

  // New question: start at the prompt so keyboard and screen-reader users begin in the right place.
  useEffect(() => {
    if (sessionId !== undefined) promptRef.current?.focus({ preventScroll: true });
  }, [sessionId, index]);

  // Feedback that ends the question moves focus to Continue; retry returns focus to the field.
  useEffect(() => {
    if (phase === "feedback") continueRef.current?.focus({ preventScroll: true });
    if (phase === "answering") inputRef.current?.focus({ preventScroll: true });
  }, [phase, index]);

  if (!session) {
    return <div className="min-h-dvh" aria-busy="true" />;
  }

  const question = currentQuestion(session, lesson);
  const record = currentRecord(session);
  const lastAttempt = record.attempts[record.attempts.length - 1];
  const inFeedback = session.phase === "feedback";
  const hasDraft = session.draft.trim().length > 0;
  const retrying = !inFeedback && record.attempts.length > 0;
  const hintsLeft = record.hintsUsed < question.hints.length;

  // Per-option marks while feedback is showing.
  let resultStates: Record<string, AnswerState> | undefined;
  if (inFeedback && question.options) {
    resultStates = {};
    const pickedCorrect = question.acceptedAnswers.includes(session.draft);
    resultStates[session.draft] = pickedCorrect ? "correct" : "incorrect";
    if (record.resolution === "exhausted") {
      for (const id of question.acceptedAnswers) resultStates[id] = "correct";
    }
  }

  let kind: FeedbackKind | null = null;
  let title = "";
  let body = "";
  if (inFeedback) {
    if (record.resolution === "correct") {
      const independent = record.classification === "correct_first_try";
      kind = independent ? "correct-independent" : "correct-assisted";
      title = independent ? question.praise : "That’s the one!";
      body = question.praiseBody;
    } else if (record.resolution === "exhausted") {
      kind = "exhausted";
      title = "Let’s look at this one together.";
      body = `The answer is: ${question.displayAnswer}`;
    } else if (record.resolution === "needs_review") {
      kind = "needs-review";
      title = "Thanks — saved for review.";
      body = lastAttempt?.message ?? "";
    } else {
      kind = "incorrect";
      title = question.nudge.title;
      body = lastAttempt?.message ?? question.nudge.body;
    }
  }

  const onChange = (value: string) => {
    setError(null);
    practiceActions.setDraft(session.id, value);
  };

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (inFeedback || !hasDraft) return;
    const outcome = practiceActions.submit(session.id, lesson);
    if (outcome.kind === "invalid" || outcome.kind === "unchanged") setError(outcome.message);
    else setError(null);
  };

  const onContinue = () => {
    if (isLastQuestion(session)) {
      leaving.current = true;
      practiceActions.advance(session.id);
      router.push(`/practice/${lessonId}/complete?session=${session.id}`);
    } else {
      practiceActions.advance(session.id);
    }
  };

  const showWhy = kind === "exhausted" || (kind === "incorrect" && record.whyViewed);
  const announcement = kind ? `${title} ${body}` : "";
  const nextHint = record.hintsUsed > 0 ? question.hints[record.hintsUsed - 1] : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-6 pt-5">
      <LessonHeader current={session.currentIndex} total={lesson.questions.length} onExit={() => setExitOpen(true)} />

      <div aria-live="polite" className="sr-only" data-testid="announcer">
        {announcement}
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 px-2 pt-3">
          <div className="flex items-center justify-between gap-2">
            <GrammarTag>{question.skillLabel}</GrammarTag>
            <button
              type="button"
              onClick={() => practiceActions.revealHint(session.id, lesson)}
              disabled={inFeedback || !hintsLeft}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-xs font-bold tracking-[0.6px] text-ink disabled:opacity-50"
            >
              <HelpCircle size={14} className="text-brand-text" aria-hidden />
              Hint
            </button>
          </div>

          <h1
            id="question-prompt"
            ref={promptRef}
            tabIndex={-1}
            className="mt-3 text-2xl font-semibold leading-[34px] tracking-[-0.25px] outline-none"
          >
            {renderPrompt(question.prompt)}
          </h1>

          {question.source && (
            <blockquote className="rounded-2xl bg-subtle p-4 text-lg font-medium leading-7">
              {question.source}
            </blockquote>
          )}

          <ExerciseView
            key={question.id}
            question={question}
            value={session.draft}
            disabled={inFeedback}
            error={error}
            resultStates={resultStates}
            onChange={onChange}
            inputRef={inputRef}
          />

          {!inFeedback && nextHint && <HintCard index={record.hintsUsed} total={question.hints.length} text={nextHint} />}
        </div>

        <div className="flex flex-col gap-3 px-2 pt-4">
          {kind ? (
            <FeedbackPanel
              kind={kind}
              title={title}
              body={body}
              why={showWhy ? question.explanation : null}
              canHint={hintsLeft}
              onWhy={() => practiceActions.markWhyViewed(session.id)}
              onHint={() => practiceActions.revealHint(session.id, lesson)}
              onRetry={() => canRetry(session) && practiceActions.retry(session.id, lesson)}
              onContinue={onContinue}
              continueRef={continueRef}
              continueLabel={isLastQuestion(session) ? "Finish lesson" : "Continue"}
            />
          ) : (
            <>
              <MigoBubble expression={retrying ? "encouraging" : hasDraft ? "idle" : "thinking"}>
                {retrying ? "No rush. A small nudge, then try again." : question.migoLine}
              </MigoBubble>
              <Button type="submit" variant={retrying ? "primary" : hasDraft ? "primary" : "secondary"} disabled={!hasDraft}>
                {retrying ? "Try again" : "Check Answer"}
              </Button>
            </>
          )}
        </div>
      </form>

      {exitOpen && (
        <ExitDialog onContinue={() => setExitOpen(false)} onSaveAndExit={() => router.push("/")} />
      )}
    </div>
  );
}
