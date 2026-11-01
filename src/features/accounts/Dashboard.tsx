"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ClipboardCheck, Smartphone, Target } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Migo } from "@/components/mascot/Migo";
import { ProfileSummary } from "@/components/progress/ProfileSummary";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { getLesson } from "@/data/lessons";
import { GuidedActivityCard } from "@/features/guided/ui/GuidedActivityCard";
import { explainNextStep } from "@/features/learning/derive";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { restartOnboarding } from "@/features/onboarding/actions";
import { getActiveSession } from "@/features/practice/selectors";
import { usePracticeState } from "@/features/practice/use-practice-state";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { timeAgo } from "@/lib/utils/time";
import { useStorageScope, writeScopeCookie } from "./scope-client";

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`rounded-[20px] border border-line bg-subtle ${className}`} />;
}

/**
 * The learner's dashboard. Everything about LEARNING comes from this device's saved history, derived exactly as on the home screen
 * (mastery, profile and recommendations are never stored). Cloud sync is not part of this release, so it never says "saved to your account"
 * about progress. Guided Correction appears only as its own labelled, provisional activity card, never as mastery.
 */
export function Dashboard({ userId, displayName, practising, welcome }: { userId: string; displayName: string; practising: string[]; welcome: boolean }) {
  const router = useRouter();
  // SHARED DEVICES. Saved progress lives in this browser, one folder per learner (see lib/scope/storage-scope). This dashboard may only ever read
  // the folder of the learner the SERVER says is signed in. If the browser is pointed anywhere else (the guest's folder, or a previous learner's
  // after they signed out), it is re-pointed here, and until that has happened nothing from the wrong folder is shown, not even for one frame.
  const scope = useStorageScope();
  const ready = scope === userId;
  useEffect(() => {
    if (!ready) {
      setStorageScope(userId);
      writeScopeCookie(userId);
    }
  }, [ready, userId]);
  const saved = usePracticeState();
  const state = ready ? saved : null;
  const learning = useDerivedLearning(state);
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  const header = (
    <div className="flex items-center gap-3 pt-2">
      <Link href="/account/profile" aria-label="Your profile" className="grid size-12 shrink-0 place-items-center rounded-full border border-brand bg-brand-soft text-lg font-bold text-brand-text">
        {initial}
      </Link>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-extrabold leading-8 tracking-[-0.3px]" data-testid="dashboard-greeting">Hi, {displayName}</h1>
        <GrammarTag style="success" className="mt-1"><Smartphone size={13} aria-hidden /> Progress on this device</GrammarTag>
      </div>
    </div>
  );

  if (!state || !learning) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1100px] px-4 pt-3 lg:px-14 lg:pt-5" aria-busy="true">
          {header}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]"><Skeleton className="h-[220px]" /><Skeleton className="h-[160px]" /></div>
        </div>
      </AppShell>
    );
  }

  const isNew = state.onboarding.status === "not_started" && state.sessions.length === 0 && state.diagnosticRuns.length === 0;
  const active = getActiveSession(state);
  const activeLesson = active ? getLesson(active.lessonId) : null;
  const top = learning.top;
  const topLesson = top ? getLesson(top.skillId) : null;
  const profile = learning.profile;
  const hasEvidence = profile.entries.some((e) => e.bucket !== "unassessed");
  const finishedRuns = state.diagnosticRuns.filter((r) => r.finishedAt !== null).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const lastRun = finishedRuns[0] ?? null;
  const diagnosticSkills = new Set(learning.events.filter((e) => e.source === "diagnostic").map((e) => e.skillId)).size;

  const welcomeNote = welcome && (
    <p role="status" className="mt-3 rounded-2xl bg-brand-soft p-3 text-sm font-semibold leading-5" data-testid="welcome-note">
      Welcome to Grammigo. Your account is ready.{" "}
      <Link href="/account/profile/edit" className="font-bold text-brand-text underline underline-offset-4">Set up your profile</Link>
    </p>
  );

  if (isNew) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[640px] px-4 pt-3 lg:px-14 lg:pt-5">
          {header}
          {welcomeNote}
          <section className="mt-8 flex flex-col items-center text-center" aria-labelledby="start-here" data-testid="dashboard-new">
            <Migo expression="encouraging" size={120} />
            <h2 id="start-here" className="mt-4 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Let’s find your starting point</h2>
            <p className="mt-2 text-base font-medium leading-6 text-ink-2">A short, friendly check shows Migo where to begin. You can skip any question.</p>
            <ButtonLink href="/onboarding" className="mt-6">Start the quick check</ButtonLink>
            <ButtonLink href="/library" variant="secondary" className="mt-3">Pick a lesson myself</ButtonLink>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] px-4 pt-3 pb-6 lg:px-14 lg:pt-5">
        {header}
        {welcomeNote}
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-4">
            {active && activeLesson && (
              <Card aria-labelledby="continue" data-testid="dashboard-continue">
                <h2 id="continue" className="text-xl font-bold leading-7">Continue where you left off</h2>
                <p className="mt-2 text-base font-semibold">{activeLesson.title}</p>
                <div
                  role="progressbar"
                  aria-label="Lesson progress"
                  aria-valuemin={0}
                  aria-valuemax={activeLesson.questions.length}
                  aria-valuenow={active.currentIndex}
                  className="mt-3 h-2.5 overflow-hidden rounded-full bg-line"
                >
                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.round((active.currentIndex / Math.max(1, activeLesson.questions.length)) * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs font-medium text-ink-2">Question {active.currentIndex + 1} of {activeLesson.questions.length} · saved {timeAgo(active.updatedAt)}</p>
                <ButtonLink href={`/practice/${active.lessonId}/session`} className="mt-4">Continue lesson</ButtonLink>
              </Card>
            )}

            {top && topLesson && (
              <section aria-labelledby="next-step" className="rounded-[20px] border border-brand bg-brand-soft p-5" data-testid="dashboard-next">
                <p className="text-xs font-bold tracking-[0.6px] text-brand-text">YOUR NEXT STEP</p>
                <h2 id="next-step" className="mt-1 text-xl font-bold leading-7">{topLesson.title}</h2>
                <p className="mt-1 text-sm font-medium leading-5 text-ink-2" data-testid="dashboard-next-reason">{explainNextStep(state, learning)}</p>
                <ButtonLink href={`/practice/${topLesson.id}`} className="mt-4">Start practice</ButtonLink>
              </section>
            )}

            <Card aria-labelledby="skills" data-testid="dashboard-skills">
              <h2 id="skills" className="text-xl font-bold leading-7">Skills so far</h2>
              {hasEvidence ? (
                <div className="mt-3"><ProfileSummary profile={profile} /></div>
              ) : (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">After a few questions we’ll show what’s going well and what to review. Nothing is “weak” until we have evidence.</p>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card aria-labelledby="quick-check" data-testid="dashboard-diagnostic">
              <h2 id="quick-check" className="flex items-center gap-2 text-xl font-bold leading-7"><ClipboardCheck size={20} aria-hidden /> Quick check</h2>
              {lastRun ? (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">
                  Taken {timeAgo(lastRun.finishedAt as number)}: {lastRun.responses.length} {lastRun.responses.length === 1 ? "answer" : "answers"}, giving early evidence on {diagnosticSkills} {diagnosticSkills === 1 ? "skill" : "skills"}.
                  {finishedRuns.length > 1 ? ` You have taken it ${finishedRuns.length} times.` : ""}
                </p>
              ) : (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">You haven’t taken the quick check yet. It helps Migo choose where to start.</p>
              )}
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  restartOnboarding("quiz");
                  router.push("/onboarding");
                }}
              >
                {lastRun ? "Retake the quick check" : "Take the quick check"}
              </Button>
            </Card>

            <Card aria-labelledby="goals" data-testid="dashboard-goals">
              <h2 id="goals" className="flex items-center gap-2 text-xl font-bold leading-7"><Target size={20} aria-hidden /> What you’re practising</h2>
              {practising.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {practising.map((t) => <li key={t}><GrammarTag style="brand">{t}</GrammarTag></li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm font-medium leading-5 text-ink-2">No topics chosen yet.</p>
              )}
              <p className="mt-3 text-xs font-medium leading-4 text-muted">Saved to your account. Your lessons start using these when your progress syncs, in a later update.</p>
              <Link href="/account/profile/edit" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-brand-text underline underline-offset-4">Edit profile and goals</Link>
            </Card>

            <GuidedActivityCard />
          </div>
        </div>
        <p className="mt-6 text-xs font-medium leading-4 text-muted" data-testid="dashboard-caveat">
          Your lessons and progress are saved in this browser, not in your account yet. This is an early picture, not a level or a grade.
        </p>
      </div>
    </AppShell>
  );
}
