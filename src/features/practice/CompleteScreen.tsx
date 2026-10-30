"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Confetti } from "@/components/progress/Confetti";
import { StatTile } from "@/components/progress/StatTile";
import { Migo } from "@/components/mascot/Migo";
import { ButtonLink } from "@/components/ui/Button";
import { getLatestCompleted, getSessionById } from "./selectors";
import { achievementMessage, formatElapsed, summarizeSession } from "./summary";
import { usePracticeState } from "./use-practice-state";

export function CompleteScreen({ lessonId, sessionId }: { lessonId: string; sessionId?: string }) {
  const router = useRouter();
  const state = usePracticeState();

  const found = state ? (sessionId ? getSessionById(state, sessionId) : getLatestCompleted(state, lessonId)) : null;
  const session = found && found.status === "completed" && found.lessonId === lessonId ? found : null;

  useEffect(() => {
    if (state && !session) router.replace(`/practice/${lessonId}`);
  }, [state, session, router, lessonId]);

  if (!session) return <div className="min-h-dvh" aria-busy="true" />;

  const summary = summarizeSession(session);
  const elapsed = formatElapsed(summary.elapsedMs);
  const notices: string[] = [];
  if (summary.needsReview > 0) {
    notices.push(
      `${summary.needsReview} ${summary.needsReview === 1 ? "answer was" : "answers were"} saved for review, because Grammigo can’t check free writing automatically yet.`,
    );
  }
  if (summary.incorrect > 0) {
    notices.push(
      `${summary.incorrect} ${summary.incorrect === 1 ? "answer was" : "answers were"} not yet correct. Your review explains each one.`,
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-8 pt-5">
      <Confetti />
      <main className="relative flex flex-1 flex-col items-center gap-4 px-2 pt-6 text-center">
        <Migo expression="celebrating" size={190} />
        <h1 className="text-[44px] font-extrabold leading-[52px] tracking-[-1px]">You did it, amigo!</h1>
        <p className="text-lg font-medium leading-7 text-ink-2">
          Another step toward better English. Look how far you’ve come!
        </p>

        <div className="mt-2 grid w-full grid-cols-2 gap-3 text-left">
          <StatTile value={summary.completed} label="exercises completed" />
          <StatTile kind="success" value={summary.independent} label="correct on your own" />
          <StatTile kind="help" value={summary.assisted} label="corrected after feedback" />
          <StatTile value={elapsed.value} label={`${elapsed.unit} of practice`} />
        </div>

        {notices.length > 0 && (
          <ul className="w-full space-y-1.5 rounded-[20px] border border-line bg-subtle p-4 text-left text-sm font-medium leading-5 text-ink-2" data-testid="success-notices">
            {notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        <div className="w-full rounded-[20px] border border-brand bg-brand-soft p-4 text-left">
          <p className="text-base font-bold leading-6">{achievementMessage(summary)}</p>
          <p className="mt-1 text-sm font-medium leading-5 text-ink-2">
            One lesson is a good step, not proof of mastery. We’ll keep checking over time.
          </p>
        </div>

        <div className="mt-auto w-full pt-2">
          <ButtonLink href={`/practice/${lessonId}/review?session=${session.id}`}>Review My Lesson</ButtonLink>
        </div>
      </main>
    </div>
  );
}
