"use client";

import { Clock } from "lucide-react";
import { DEFAULT_LESSON_ID, getLesson } from "@/data/lessons";
import { getSkill } from "@/data/grammar/skills";
import { AppShell } from "@/components/layout/AppShell";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo } from "@/components/mascot/Migo";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag, type TagStyle } from "@/components/ui/GrammarTag";
import { collectEvidence } from "@/features/mastery/evidence";
import { recommendNext } from "@/features/mastery/recommend";
import { getActiveSession, getCompletedSessions } from "@/features/practice/selectors";
import { summarizeSession } from "@/features/practice/summary";
import { usePracticeState } from "@/features/practice/use-practice-state";
import { timeAgo } from "@/lib/utils/time";

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`rounded-[20px] border border-line bg-subtle ${className}`} />;
}

export function HomeScreen() {
  const lesson = getLesson(DEFAULT_LESSON_ID)!;
  const state = usePracticeState();

  if (!state) {
    return (
      <AppShell>
        <div className="mx-auto max-w-[1100px] px-4 pt-3 lg:px-14 lg:pt-5" aria-busy="true">
          <div className="flex h-14 items-center lg:hidden"><Wordmark className="px-2 text-2xl" /></div>
          <h1 className="mt-2 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Good to see you</h1>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
            <Skeleton className="h-[260px]" />
            <Skeleton className="h-[150px]" />
          </div>
        </div>
      </AppShell>
    );
  }

  const active = getActiveSession(state, lesson.id);
  const completed = getCompletedSessions(state, lesson.id);
  const latest = completed[0] ?? null;
  const evidence = latest ? collectEvidence(latest, lesson) : [];
  const recommendation = latest
    ? recommendNext(evidence, lesson, (id) => getSkill(id).title)
    : null;
  const latestSummary = latest ? summarizeSession(latest) : null;

  const skillRows = [...new Map(lesson.questions.map((q) => [q.skillId, getSkill(q.skillId)])).values()];
  const label = (skillId: string): { text: string; style: TagStyle } => {
    const ev = evidence.find((e) => e.skillId === skillId);
    if (!ev) return { text: "Not assessed", style: "neutral" };
    if (ev.incorrect + ev.assisted > 0) return { text: "Needs practice", style: "warning" };
    if (ev.independent > 0) return { text: "Learning", style: "info" };
    return { text: "Not assessed", style: "neutral" };
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] px-4 pt-3 lg:px-14 lg:pt-5">
        <div className="flex h-14 items-center lg:hidden">
          <Wordmark className="px-2 text-2xl" />
        </div>
        <h1 className="mt-2 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Good to see you</h1>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_380px]">
          <section aria-labelledby="next-step" className="rounded-[20px] border border-brand bg-brand-soft p-6">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-bold tracking-[0.6px] text-brand-text">
                  {active ? "Lesson in progress" : "Recommended for you"}
                </p>
                <h2 id="next-step" className="mt-2 text-[26px] font-extrabold leading-8 tracking-[-0.3px]">
                  {lesson.title}
                </h2>
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2" data-testid="next-step-text">
                  {active
                    ? `You’re on question ${active.currentIndex + 1} of ${lesson.questions.length}. Your progress was saved when you left.`
                    : recommendation
                      ? recommendation.reason
                      : lesson.homeReason}
                </p>
              </div>
              <Migo expression="encouraging" size={99} className="hidden min-[380px]:inline-block" />
            </div>
            <ButtonLink
              href={active ? `/practice/${lesson.id}/session` : `/practice/${lesson.id}`}
              className="mt-5"
            >
              {active ? "Continue Lesson" : "Start Practice"}
            </ButtonLink>
            <p className="mt-4 text-xs font-medium leading-4 text-ink-2">
              {active ? (
                <>
                  <span className="font-bold text-ink">Saved {timeAgo(active.updatedAt)}</span> · You can pick up
                  exactly where you stopped.
                </>
              ) : (
                <>
                  <span className="font-bold text-ink">Why this?</span>{" "}
                  {latest ? "Based on your last session." : "A good place to start with verb tenses."}
                </>
              )}
            </p>
          </section>

          <div className="flex flex-col gap-4">
            {latest && latestSummary && (
              <Card className="p-5" aria-labelledby="last-session">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="last-session" className="text-xl font-bold leading-7">Your last session</h2>
                  <GrammarTag style="neutral">
                    <Clock size={13} aria-hidden /> {timeAgo(latest.completedAt ?? latest.updatedAt)}
                  </GrammarTag>
                </div>
                <dl className="mt-3 space-y-2 text-base font-medium leading-6">
                  <div className="flex justify-between" data-testid="home-independent">
                    <dt className="text-ink-2">Correct on your own</dt>
                    <dd className="font-bold">{latestSummary.independent}</dd>
                  </div>
                  <div className="flex justify-between" data-testid="home-assisted">
                    <dt className="text-ink-2">Corrected after help</dt>
                    <dd className="font-bold">{latestSummary.assisted}</dd>
                  </div>
                  {latestSummary.needsReview + latestSummary.incorrect > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ink-2">Saved for review / missed</dt>
                      <dd className="font-bold">{latestSummary.needsReview + latestSummary.incorrect}</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 text-xs font-medium text-muted">
                  {completed.length} {completed.length === 1 ? "session" : "sessions"} completed
                </p>
                <ButtonLink
                  href={`/practice/${lesson.id}/review?session=${latest.id}`}
                  variant="secondary"
                  className="mt-4"
                >
                  Review last lesson
                </ButtonLink>
              </Card>
            )}

            <Card className="p-5" aria-labelledby="progress-title">
              <h2 id="progress-title" className="text-xl font-bold leading-7">Your progress</h2>
              {latest ? (
                <ul className="mt-3 space-y-3">
                  {skillRows.map((skill) => {
                    const l = label(skill.id);
                    return (
                      <li key={skill.id} className="flex items-center justify-between gap-3 text-base font-medium leading-6">
                        <span>{skill.title}</span>
                        <GrammarTag style={l.style} className="shrink-0">{l.text}</GrammarTag>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">
                  After a few questions, we’ll show what’s going well and what to review. Nothing is “weak”
                  until we have evidence.
                </p>
              )}
              {latest && (
                <p className="mt-3 text-xs font-medium leading-4 text-muted">
                  Based on your latest attempt. One lesson is a good step, not proof of mastery.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
