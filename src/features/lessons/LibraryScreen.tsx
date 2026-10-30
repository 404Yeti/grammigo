"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock } from "lucide-react";
import { CEFR_LEVELS, type CefrLevel } from "@/curriculum/schema";
import { availableLevels, listSkills, listTopics, requireSkill } from "@/curriculum";
import { AppShell } from "@/components/layout/AppShell";
import { MasteryBadge } from "@/components/ui/MasteryBadge";
import { ButtonLink } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { explainNextStep } from "@/features/learning/derive";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { prerequisiteReadiness } from "@/features/learning/recommend";
import { getActiveSession, getCompletedSessions } from "@/features/practice/selectors";
import { usePracticeState } from "@/features/practice/use-practice-state";
import { cn } from "@/lib/utils/cn";

function Chip({ active, disabled, onClick, children }: { active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold",
        active ? "border-inverse bg-inverse text-on-inverse" : "border-line-strong bg-surface text-ink hover:bg-subtle",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Grammar Library: browse every lesson. Levels and topics are optional filters, never a gate or a
 * placement. Everything is startable; hints about prerequisites are advice, not locks.
 */
export function LibraryScreen() {
  const state = usePracticeState();
  const [level, setLevel] = useState<CefrLevel | null>(null);
  const [topic, setTopic] = useState<string | null>(null);

  const skills = listSkills();
  const learning = useDerivedLearning(state);
  const levels = availableLevels();
  const topics = listTopics();
  const visible = skills.filter((s) => (!level || s.cefr === level) && (!topic || s.topic === topic));

  if (!state || !learning) {
    return (
      <AppShell>
        <div className="mx-auto max-w-[1100px] px-4 pt-5 lg:px-14" aria-busy="true">
          <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Grammar library</h1>
        </div>
      </AppShell>
    );
  }

  const active = getActiveSession(state);
  const top = learning.top;
  const topSkill = top ? requireSkill(top.skillId) : null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] px-4 pt-5 lg:px-14">
        <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Grammar library</h1>
        <p className="mt-1 text-sm font-medium leading-5 text-ink-2">
          Pick any lesson. Levels are just labels: you don’t need to choose one, and nothing is locked.
        </p>

        {topSkill && top && (
          <section className="mt-4 rounded-[20px] border border-brand bg-brand-soft p-5" data-testid="library-recommended" aria-labelledby="rec-title">
            <p className="text-xs font-bold tracking-[0.6px] text-brand-text">Recommended for you</p>
            <h2 id="rec-title" className="mt-1 text-xl font-bold leading-7">{topSkill.title}</h2>
            <p className="mt-1 text-sm font-medium leading-5 text-ink-2">{explainNextStep(state, learning)}</p>
            <div className="mt-3 max-w-xs">
              <ButtonLink href={active && active.lessonId === top.skillId ? `/practice/${top.skillId}/session` : `/practice/${top.skillId}`}>
                {active && active.lessonId === top.skillId ? "Continue lesson" : "Start this lesson"}
              </ButtonLink>
            </div>
          </section>
        )}

        <div className="mt-5 flex flex-col gap-3" role="group" aria-label="Filters">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Level">
            <Chip active={!level} onClick={() => setLevel(null)}>All levels</Chip>
            {CEFR_LEVELS.map((l) => (
              <Chip key={l} active={level === l} disabled={!levels.includes(l)} onClick={() => setLevel(l)}>
                {l}
                {!levels.includes(l) && <span className="sr-only"> (no lessons yet)</span>}
              </Chip>
            ))}
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Topic">
            <Chip active={!topic} onClick={() => setTopic(null)}>All topics</Chip>
            {topics.map((t) => (
              <Chip key={t} active={topic === t} onClick={() => setTopic(t)}>{t}</Chip>
            ))}
          </div>
          <p className="text-xs font-medium text-muted">C1 and C2 lessons aren’t available yet.</p>
        </div>

        <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="lesson-list">
          {visible.map((skill) => {
            const m = learning.mastery.get(skill.id)!;
            const completed = getCompletedSessions(state, skill.id).length;
            const inProgress = active?.lessonId === skill.id;
            const readiness = prerequisiteReadiness(skill, learning.mastery);
            const isTop = top?.skillId === skill.id;
            return (
              <li key={skill.id} data-testid="lesson-card" data-skill={skill.id}>
                <Link
                  href={`/practice/${skill.id}`}
                  className={cn("flex h-full flex-col gap-2 rounded-[20px] border bg-surface p-4 hover:bg-subtle", isTop ? "border-brand" : "border-line")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <GrammarTag style="neutral">{skill.cefr}</GrammarTag>
                    <span className="flex items-center gap-1 text-xs font-medium text-muted">
                      <Clock size={13} aria-hidden /> {skill.estimatedMinutes} min
                    </span>
                  </div>
                  <h3 className="text-lg font-bold leading-6">{skill.title}</h3>
                  <p className="text-xs font-medium text-ink-2">{skill.topic}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <MasteryBadge mastery={m} />
                    <span className="text-xs font-semibold text-ink-2" data-testid="completion">
                      {inProgress ? "In progress" : completed > 0 ? `Completed ${completed}×` : "Not started"}
                    </span>
                  </div>
                  {readiness.state === "not_ready" && (
                    <p className="text-xs font-medium text-warning-text">
                      Tip: “{requireSkill(readiness.weak[0]).title}” may help first.
                    </p>
                  )}
                  {isTop && <p className="text-xs font-bold text-brand-text">Recommended for you</p>}
                </Link>
              </li>
            );
          })}
        </ul>
        {visible.length === 0 && <p className="mt-4 text-sm font-medium text-ink-2">No lessons match those filters.</p>}
      </div>
    </AppShell>
  );
}
