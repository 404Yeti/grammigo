"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getLesson } from "@/data/lessons";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo } from "@/components/mascot/Migo";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { startSession } from "@/features/practice/actions";
import { getActiveSession } from "@/features/practice/selectors";
import { usePracticeState } from "@/features/practice/use-practice-state";


export function IntroScreen({ lessonId }: { lessonId: string }) {
  const lesson = getLesson(lessonId)!;
  const router = useRouter();
  const state = usePracticeState();
  const active = state ? getActiveSession(state, lessonId) : null;

  const start = () => {
    if (!active) startSession(lesson);
    router.push(`/practice/${lessonId}/session`);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-8 pt-5">
      <header className="flex h-11 items-center">
        <Link
          href="/"
          aria-label="Back"
          className="grid size-11 place-items-center rounded-full bg-subtle text-ink hover:bg-sand"
        >
          <ChevronLeft size={20} aria-hidden />
        </Link>
        <div className="flex flex-1 justify-center">
          <Wordmark />
        </div>
        <div className="size-11" aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-2 pt-3">
        <div className="flex justify-center pt-2">
          <Migo expression="curious" size={132} />
        </div>

        <p className="rounded-[20px] border border-line bg-surface p-4 text-lg font-medium leading-7">
          {lesson.intro}
        </p>

        <GrammarTag className="mt-1 w-fit">{lesson.grammarFocus}</GrammarTag>
        <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">{lesson.title}</h1>

        <ul className="flex flex-wrap gap-2.5" aria-label="Lesson details">
          <li className="rounded-full bg-subtle px-3.5 py-2 text-xs font-bold tracking-[0.6px]">
            {lesson.minutes} minutes
          </li>
          <li className="rounded-full bg-subtle px-3.5 py-2 text-xs font-bold tracking-[0.6px]">
            {lesson.questions.length} exercises
          </li>
        </ul>

        <Card className="rounded-[20px]">
          <h2 className="text-base font-bold leading-6">You’ll practice</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-base font-medium leading-6 text-ink-2 marker:text-muted">
            {lesson.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </Card>

        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Button onClick={start}>{active ? "Continue Lesson" : "Start Lesson"}</Button>
          <ButtonLink href="/" variant="ghost">
            Back to Home
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
