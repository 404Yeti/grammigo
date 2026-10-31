"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, RotateCcw } from "lucide-react";
import { getLesson } from "@/data/lessons";
import { getSkill } from "@/data/grammar/skills";
import { ReviewCard } from "@/components/lesson/ReviewCard";
import { Migo } from "@/components/mascot/Migo";
import { Button, ButtonLink } from "@/components/ui/Button";
import { requireSkill } from "@/curriculum";
import { collectEvidence } from "@/features/mastery/evidence";
import { explainNextStep } from "@/features/learning/derive";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { GuidedEntryCard } from "@/features/guided/ui/GuidedEntryCard";
import { startSession } from "./actions";
import { buildReviewItems } from "./review";
import { getLatestCompleted, getSessionById } from "./selectors";
import { usePracticeState } from "./use-practice-state";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-4 text-sm font-semibold leading-5 text-ink-2">{children}</h2>;
}

export function ReviewScreen({ lessonId, sessionId: sessionIdProp }: { lessonId: string; sessionId?: string }) {
  const lesson = getLesson(lessonId)!;
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = sessionIdProp ?? searchParams.get("session") ?? undefined;
  const state = usePracticeState();
  const learning = useDerivedLearning(state);

  const found = state ? (sessionId ? getSessionById(state, sessionId) : getLatestCompleted(state, lessonId)) : null;
  const session = found && found.status === "completed" && found.lessonId === lessonId ? found : null;

  useEffect(() => {
    if (state && !session) router.replace(`/practice/${lessonId}`);
  }, [state, session, router, lessonId]);

  if (!session) return <div className="min-h-dvh" aria-busy="true" />;

  const evidence = collectEvidence(session, lesson);
  const strengths = evidence.filter((e) => e.independent > 0 && e.assisted + e.incorrect === 0);
  const practice = evidence.filter((e) => e.assisted + e.incorrect > 0);
  const items = buildReviewItems(session, lesson, (qid) => state?.writingFeedback[`${session.id}:${qid}`]);
  const next = learning?.top ?? null;
  const nextSkill = next ? requireSkill(next.skillId) : null;
  const nextReason = state && learning ? explainNextStep(state, learning) : "";

  const practiceAgain = () => {
    startSession(lesson);
    router.push(`/practice/${lessonId}/session`);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-8 pt-5">
      <header className="flex h-11 items-center">
        <Link
          href={`/practice/${lessonId}/complete?session=${session.id}`}
          aria-label="Back to results"
          className="grid size-11 place-items-center rounded-full bg-subtle text-ink hover:bg-sand"
        >
          <ChevronLeft size={20} aria-hidden />
        </Link>
      </header>

      <main className="flex flex-col gap-3 px-2 pt-3">
        <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Your Lesson Review</h1>
        <p className="text-base font-medium leading-6 text-ink-2" data-testid="review-topic">{lesson.title}</p>

        <SectionTitle>A · Your strengths</SectionTitle>
        {strengths.length === 0 ? (
          <p className="rounded-[20px] border border-line bg-subtle p-4 text-sm font-medium leading-5 text-ink-2">
            Nothing was fully independent this time, and that’s okay. Each answer you corrected is evidence too.
          </p>
        ) : (
          strengths.map((e) => {
            const skill = getSkill(e.skillId);
            return (
              <div key={e.skillId} className="rounded-[20px] border border-success-border bg-success-soft p-4" data-testid="strength">
                <p className="flex items-start gap-2 text-base font-semibold leading-6">
                  <Check size={18} className="mt-0.5 shrink-0 text-success" aria-hidden /> {skill.title}
                </p>
                <p className="mt-1 text-sm font-medium leading-5 text-ink-2">{skill.strengthText}</p>
              </div>
            );
          })
        )}

        {practice.length > 0 && (
          <>
            <SectionTitle>B · Keep practicing</SectionTitle>
            {practice.map((e) => {
              const skill = getSkill(e.skillId);
              return (
                <div key={e.skillId} className="rounded-[20px] bg-warning-soft p-4" data-testid="practice-area">
                  <p className="flex items-start gap-2 text-base font-semibold leading-6">
                    <RotateCcw size={17} className="mt-1 shrink-0" aria-hidden /> {skill.title}
                  </p>
                  <p className="mt-1 text-sm font-medium leading-5 text-ink-2">{skill.practiceText}</p>
                </div>
              );
            })}
          </>
        )}

        <SectionTitle>C · Review your answers</SectionTitle>
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ReviewCard
              key={item.questionId}
              number={item.number}
              title={item.title}
              result={item.result}
              details={item.details}
              why={item.why}
            />
          ))}
        </div>

        <SectionTitle>D · Recommended next step</SectionTitle>
        <section className="rounded-[20px] border border-brand bg-brand-soft p-4" data-testid="recommendation">
          <div className="flex items-center gap-3">
            <Migo expression="happy" size={64} />
            <p className="flex-1 rounded-2xl border border-line bg-surface px-3.5 py-3 text-sm font-medium leading-5" data-testid="next-reason">
              {nextReason}
            </p>
          </div>
          {nextSkill && next && (
            <Link
              href={`/practice/${next.skillId}`}
              className="mt-3 block rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-subtle"
              data-testid="next-lesson-link"
            >
              <p className="text-base font-semibold leading-6">{nextSkill.title}</p>
              <p className="text-xs font-medium text-muted">
                About {nextSkill.estimatedMinutes} minutes · {nextSkill.questions.length} exercises · open lesson
              </p>
            </Link>
          )}
        </section>

        <GuidedEntryCard lessonId={lessonId} variant="review" />

        <div className="mt-4 flex flex-col gap-2.5">
          <ButtonLink href="/">Return Home</ButtonLink>
          <Button variant="secondary" onClick={practiceAgain}>
            Practice This Skill Again
          </Button>
        </div>
      </main>
    </div>
  );
}
