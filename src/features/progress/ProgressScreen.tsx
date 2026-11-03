"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo } from "@/components/mascot/Migo";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { getCurriculumSkill, requireSkill } from "@/curriculum";
import { useLocalClock } from "@/features/activity/use-local-clock";
import { explainNextStep } from "@/features/learning/derive";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { getActiveSession } from "@/features/practice/selectors";
import { usePracticeState } from "@/features/practice/use-practice-state";
import { evidenceLabel, progressOverview } from "./derive";

const linkClass = "inline-flex min-h-11 items-center font-bold text-brand-text underline underline-offset-4";

export function ProgressScreen() {
  const state = usePracticeState();
  const learning = useDerivedLearning(state);
  return <AppShell>
    <main className="mx-auto w-full max-w-[1100px] px-4 pt-3 lg:px-14 lg:pt-5">
      <div className="flex h-14 items-center lg:hidden"><Wordmark className="px-2 text-2xl" /></div>
      <h1 className="mt-2 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Your progress</h1>
      <p className="mt-1 text-sm font-medium leading-5 text-ink-2">See what you’ve practiced and where to go next, amigo.</p>
      {state && learning ? <ProgressContent state={state} learning={learning} /> : <p role="status" className="mt-6" aria-busy="true">Loading your saved progress…</p>}
    </main>
  </AppShell>;
}

function ProgressContent({ state, learning }: { state: NonNullable<ReturnType<typeof usePracticeState>>; learning: NonNullable<ReturnType<typeof useDerivedLearning>> }) {
  const { now, timeZone } = useLocalClock();
  const progress = progressOverview(state, learning, now);
  const active = getActiveSession(state);
  const activeSkill = active ? getCurriculumSkill(active.lessonId) : null;
  const top = learning.top;
  const recommendations = learning.recommendations.slice(0, 2);
  const labelDate = (at: number) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(at);
  return <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
    <div className="min-w-0 space-y-4">
      <Card aria-labelledby="progress-overview">
        <h2 id="progress-overview" className="text-xl font-bold leading-7">Learning overview</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-subtle p-4"><dt className="text-sm text-ink-2">Lessons completed</dt><dd className="mt-1 text-2xl font-extrabold" data-testid="progress-completed">{progress.completedLessons}</dd></div>
          <div className="rounded-2xl bg-subtle p-4"><dt className="text-sm text-ink-2">Grammar topics practiced</dt><dd className="mt-1 text-2xl font-extrabold" data-testid="progress-topics">{progress.topics.length}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted">{progress.completed.length} completed {progress.completed.length === 1 ? "session" : "sessions"}, including repeat practice. Each lesson counts once above. Topics include answered quick-check and lesson questions.</p>
        {progress.topics.length === 0 && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-brand-soft p-4" data-testid="progress-empty"><Migo expression="encouraging" size={64} /><p className="text-sm leading-6">Your story starts with one lesson. Migo will show your progress here as you practice.</p></div>}
      </Card>

      <Card aria-labelledby="progress-grammar">
        <h2 id="progress-grammar" className="text-xl font-bold leading-7">Grammar progress</h2>
        <p className="mt-1 text-sm leading-5 text-ink-2">Checked answers show what went well and what needed help. Early evidence can change; unverified answers are never counted as wrong.</p>
        {progress.topics.length === 0 ? <p className="mt-4 text-sm text-ink-2">No grammar evidence yet. Start with the next step below.</p> : <ul className="mt-4 divide-y divide-line" data-testid="progress-grammar-list">
          {progress.topics.map(entry => {
            const m = entry.mastery;
            const observation = progress.latestSpeaking.get(entry.skillId);
            const checked = m.independent + m.assisted + m.incorrect;
            return <li key={entry.skillId} className="py-4 first:pt-0" data-skill={entry.skillId}>
              <h3 className="font-bold leading-6">{entry.title}</h3>
              <div className="mt-2 flex flex-wrap gap-2"><GrammarTag style="neutral">{entry.cefr} lesson</GrammarTag><GrammarTag style={m.status === "needs_practice" && !m.provisional ? "warning" : "info"}>{evidenceLabel(entry)}</GrammarTag></div>
              <p className="mt-2 text-sm leading-6 text-ink-2">{checked ? `${m.independent} ${m.independent === 1 ? "answer" : "answers"} on your own · ${m.assisted} with help · ${m.incorrect} missed` : "You practiced this topic, but there aren’t enough reliably checked answers to judge it yet."}</p>
              {checked > 0 && <p className="text-xs leading-5 text-muted">{learning.events.filter(e => e.skillId === entry.skillId && e.source === "lesson").length} lesson answers · {learning.events.filter(e => e.skillId === entry.skillId && e.source === "diagnostic").length} quick-check answers. {m.provisional ? "Only a little evidence so far." : m.reviewDue ? "A refresher is due." : "Keep practicing to build a clearer picture."}</p>}
              {observation && <p className="mt-2 text-sm leading-6 text-ink-2" data-testid="progress-speaking">{observation} Speaking observations do not change your checked-answer profile or recommendations.</p>}
              <Link className={linkClass} href={`/practice/${entry.skillId}`}>Practice {entry.title}</Link>
            </li>;
          })}
        </ul>}
        <p className="mt-3 text-xs leading-5 text-muted">Topics without evidence are unassessed, rather than weak. These observations are not a proficiency score.</p>
      </Card>

      <Card aria-labelledby="progress-recent">
        <h2 id="progress-recent" className="text-xl font-bold leading-7">Recent completed lessons</h2>
        {progress.completed.length === 0 ? <p className="mt-2 text-sm text-ink-2">No completed lessons yet. Unfinished lessons stay saved for later.</p> : <ul className="mt-2 divide-y divide-line" data-testid="progress-recent-list">
          {progress.completed.slice(0, 5).map(session => <li key={session.id} className="py-3">
            <h3 className="font-bold">{requireSkill(session.lessonId).title}</h3>
            <time className="mt-1 block text-sm text-ink-2" dateTime={new Date(session.completedAt!).toISOString()}>{labelDate(session.completedAt!)}</time>
            <Link className={linkClass} href={`/practice/${session.lessonId}/review?session=${encodeURIComponent(session.id)}`}>Review this session<span className="sr-only"> of {requireSkill(session.lessonId).title}, {labelDate(session.completedAt!)}</span></Link>
          </li>)}
        </ul>}
        <p className="mt-2 text-xs text-muted">Dates use your current timezone: {timeZone.replaceAll("_", " ")}.</p>
      </Card>
    </div>

    <div className="min-w-0 space-y-4">
      <Card aria-labelledby="progress-next" className="border-brand bg-brand-soft">
        <h2 id="progress-next" className="text-xl font-bold leading-7">Your next steps</h2>
        {active && activeSkill && <div className="mt-3" data-testid="progress-continue"><p className="text-sm leading-6">You have a saved lesson in progress: {activeSkill.title}.</p><ButtonLink className="mt-2" href={`/practice/${active.lessonId}/session`}>Continue Lesson</ButtonLink></div>}
        <ul className="mt-4 space-y-4" data-testid="progress-recommendations">{recommendations.map(rec => <li key={rec.skillId}>
          <h3 className="font-bold">{requireSkill(rec.skillId).title}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-2">{rec === top ? explainNextStep(state, learning) : rec.reason}</p>
          <Link className={linkClass} href={`/practice/${rec.skillId}`}>Practice this topic<span className="sr-only">: {requireSkill(rec.skillId).title}</span></Link>
        </li>)}</ul>
        <Link href="/library" className={linkClass}>Browse all lessons</Link>
      </Card>

      <Card aria-labelledby="progress-cefr">
        <h2 id="progress-cefr" className="text-xl font-bold leading-7">CEFR development</h2>
        <h3 className="mt-3 font-bold">Estimated placement</h3>
        <p className="mt-1 text-sm leading-6 text-ink-2" data-testid="progress-placement">No CEFR placement estimate is available in your saved learning data. The quick check builds a grammar profile; it does not assign a CEFR level.</p>
        <p className="mt-2 text-sm leading-6 text-ink-2">A placement estimate would be a starting point, not a certification. Completing a lesson does not demonstrate proficiency at that level.</p>
        <h3 className="mt-4 font-bold">Evidence by lesson level</h3>
        {progress.levels.length === 0 ? <p className="mt-2 text-sm text-ink-2">Lesson-level evidence will appear after you answer questions.</p> : <ul className="mt-2 space-y-3" data-testid="progress-levels">{progress.levels.map(level => <li key={level.level} className="rounded-2xl bg-subtle p-3 text-sm leading-6"><span className="font-bold">{level.level} lessons</span><p>{level.completed} completed · {level.topics} {level.topics === 1 ? "topic" : "topics"} practiced · {level.checked} checked answers</p></li>)}</ul>}
        <p className="mt-3 text-xs leading-5 text-muted">CEFR labels describe lesson content, not your overall English level.</p>
      </Card>
    </div>
  </div>;
}
