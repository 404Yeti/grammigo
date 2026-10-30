"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Clock } from "lucide-react";
import { requireSkill } from "@/curriculum";
import { getLesson } from "@/data/lessons";
import { AppShell } from "@/components/layout/AppShell";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo } from "@/components/mascot/Migo";
import { MasteryBadge } from "@/components/ui/MasteryBadge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { explainNextStep } from "@/features/learning/derive";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { restartOnboarding } from "@/features/onboarding/actions";
import { getActiveSession, getCompletedSessions } from "@/features/practice/selectors";
import { summarizeSession } from "@/features/practice/summary";
import { usePracticeState } from "@/features/practice/use-practice-state";
import { timeAgo } from "@/lib/utils/time";

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`rounded-[20px] border border-line bg-subtle ${className}`} />;
}

export function HomeScreen() {
  const router = useRouter();
  const state = usePracticeState();
  const learning = useDerivedLearning(state);

  // A brand-new learner meets Migo first. Anyone with history (including v0.1 learners) is never forced.
  const isNew = state ? state.onboarding.status === "not_started" && state.sessions.length === 0 : false;
  const inFlow = state?.onboarding.status === "in_progress";
  useEffect(() => {
    if (isNew || inFlow) router.replace("/onboarding");
  }, [isNew, inFlow, router]);

  if (!state || !learning || isNew || inFlow) {
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

  const active = getActiveSession(state);
  const activeLesson = active ? getLesson(active.lessonId) : null;
  const completed = getCompletedSessions(state);
  const latest = completed[0] ?? null;
  const latestSummary = latest ? summarizeSession(latest) : null;
  const top = learning.top;
  const topLesson = top ? getLesson(top.skillId) : null;
  const dueReviews = learning.recommendations.filter((r) => r.kind === "review").slice(0, 3);
  const profile = learning.profile;
  const hasEvidence = profile.entries.some((e) => e.bucket !== "unassessed");
  const skipped = state.onboarding.status === "skipped" && state.diagnosticRuns.length === 0;

  const heroLesson = active ? activeLesson : topLesson;
  const heroText = active
    ? `You’re on question ${active.currentIndex + 1} of ${activeLesson?.questions.length}. Your progress was saved when you left.`
    : top
      ? explainNextStep(state, learning)
      : "";

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
                <h2 id="next-step" className="mt-2 text-2xl font-bold leading-8 tracking-[-0.3px]">
                  {heroLesson?.title ?? "Pick a lesson"}
                </h2>
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2" data-testid="next-step-text">
                  {heroText}
                </p>
              </div>
              <Migo expression="encouraging" size={99} className="hidden min-[380px]:inline-block" />
            </div>
            {heroLesson && (
              <ButtonLink
                href={active ? `/practice/${heroLesson.id}/session` : `/practice/${heroLesson.id}`}
                className="mt-5"
              >
                {active ? "Continue Lesson" : "Start Practice"}
              </ButtonLink>
            )}
            <p className="mt-4 text-xs font-medium leading-4 text-ink-2">
              {active ? (
                <>
                  <span className="font-bold text-ink">Saved {timeAgo(active.updatedAt)}</span> · You can pick up exactly where you stopped.
                </>
              ) : (
                <>
                  <span className="font-bold text-ink">Why this?</span>{" "}
                  {hasEvidence ? "Based on your quick check and lessons." : "A friendly place to start."}{" "}
                  <Link href="/library" className="font-bold text-brand-text underline underline-offset-4">
                    Choose another lesson
                  </Link>
                </>
              )}
            </p>
          </section>

          <div className="flex flex-col gap-4">
            {skipped && (
              <Card className="p-5" aria-labelledby="meet-migo">
                <h2 id="meet-migo" className="text-xl font-bold leading-7">Want a better starting point?</h2>
                <p className="mt-1 text-sm font-medium leading-5 text-ink-2">
                  Tell Migo what’s tricky and answer a few quick questions. It takes about two minutes.
                </p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    restartOnboarding("concerns");
                    router.push("/onboarding");
                  }}
                >
                  Tell Migo
                </Button>
              </Card>
            )}

            {dueReviews.length > 0 && (
              <Card className="p-5" aria-labelledby="review-due" data-testid="review-due">
                <h2 id="review-due" className="text-xl font-bold leading-7">Review due</h2>
                <ul className="mt-2 space-y-2">
                  {dueReviews.map((r) => (
                    <li key={r.skillId}>
                      <Link href={`/practice/${r.skillId}`} className="flex items-center justify-between gap-3 text-base font-medium leading-6 hover:underline">
                        <span>{requireSkill(r.skillId).title}</span>
                        <GrammarTag style="brand">Review</GrammarTag>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {latest && latestSummary && (
              <Card className="p-5" aria-labelledby="last-session">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="last-session" className="text-xl font-bold leading-7">Your last session</h2>
                  <GrammarTag style="neutral">
                    <Clock size={13} aria-hidden /> {timeAgo(latest.completedAt ?? latest.updatedAt)}
                  </GrammarTag>
                </div>
                <p className="mt-1 text-sm font-semibold text-ink-2">{getLesson(latest.lessonId)?.title}</p>
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
                <ButtonLink href={`/practice/${latest.lessonId}/review?session=${latest.id}`} variant="secondary" className="mt-4">
                  Review last lesson
                </ButtonLink>
              </Card>
            )}

            <Card className="p-5" aria-labelledby="progress-title" data-testid="home-profile">
              <h2 id="progress-title" className="text-xl font-bold leading-7">Your learning profile</h2>
              {hasEvidence ? (
                <>
                  <ul className="mt-3 space-y-3">
                    {[...profile.weaknesses, ...profile.inProgress, ...profile.strengths].slice(0, 5).map((e) => (
                      <li key={e.skillId} className="flex items-center justify-between gap-3 text-base font-medium leading-6">
                        <span>{e.title}</span>
                        <span className="shrink-0"><MasteryBadge mastery={e.mastery} /></span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs font-medium leading-4 text-muted">
                    {profile.unassessed.length} {profile.unassessed.length === 1 ? "area isn’t" : "areas aren’t"} checked yet (not the same as weak). {profile.caveat}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">
                  After a few questions, we’ll show what’s going well and what to review. Nothing is “weak” until we have evidence.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold text-brand-text">
                <Link href="/library" className="min-h-11 py-2.5 underline underline-offset-4">Browse all lessons</Link>
                <button
                  type="button"
                  className="min-h-11 py-2.5 underline underline-offset-4"
                  onClick={() => {
                    restartOnboarding("concerns");
                    router.push("/onboarding");
                  }}
                >
                  Update my goals
                </button>
                <button
                  type="button"
                  className="min-h-11 py-2.5 underline underline-offset-4"
                  onClick={() => {
                    restartOnboarding("quiz");
                    router.push("/onboarding");
                  }}
                >
                  Retake the quick check
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
