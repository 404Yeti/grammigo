"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { getCurriculumSkill, listSkills } from "@/curriculum";
import { getLesson } from "@/data/lessons";
import { ExerciseView } from "@/components/exercises/ExerciseView";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo, type MigoExpression } from "@/components/mascot/Migo";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import { ProfileSummary } from "@/components/progress/ProfileSummary";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { fetchAiStatus, requestGoals, requestTranscription } from "@/features/ai/client";
import { canExtend, gradeDiagnosticAnswer, selectNextItem } from "@/features/diagnostic/engine";
import { useDerivedLearning } from "@/features/learning/use-learning";
import { buildGoals, extractGoalsLocally } from "@/features/learning/goals";
import { startSession } from "@/features/practice/actions";
import { usePracticeState } from "@/features/practice/use-practice-state";
import type { LearnerGoals, StoredState } from "@/types/session";
import {
  answerQuizItem,
  beginOnboarding,
  completeOnboarding,
  diagnosticPool,
  extendQuiz,
  goToStep,
  removeGoalSkill,
  restartOnboarding,
  saveGoalsForConfirmation,
  setConcernsDraft,
  showRecommendation,
  skipConversation,
  skipOnboarding,
  startQuiz,
} from "./actions";
import { VoiceRecorder } from "./VoiceRecorder";
import { AiNotice } from "@/components/ui/AiNotice";

const EXAMPLES = ["I mix up past tenses", "Articles confuse me", "I’m not sure about conditionals", "Prepositions like at, on, in"];

function Frame({
  children,
  onBack,
  expression,
  testId,
}: {
  children: React.ReactNode;
  onBack?: () => void;
  expression?: MigoExpression;
  testId: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-8 pt-5" data-testid={testId}>
      <header className="flex h-11 items-center">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid size-11 place-items-center rounded-full bg-subtle text-ink hover:bg-sand"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
        ) : (
          <div className="size-11" aria-hidden />
        )}
        <div className="flex flex-1 justify-center">
          <Wordmark />
        </div>
        <div className="size-11" aria-hidden />
      </header>
      <main className="flex flex-1 flex-col gap-4 px-2 pt-3">
        {expression && (
          <div className="flex justify-center">
            <Migo expression={expression} size={112} />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- Welcome */

function Welcome({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  return (
    <Frame testId="onboarding-welcome" expression="happy">
      <h1 className="text-center text-[32px] font-extrabold leading-10 tracking-[-0.5px]">Hi, I’m Migo!</h1>
      <p className="rounded-[20px] border border-line bg-surface p-4 text-center text-lg font-semibold leading-7">
        What would you like to improve about your English?
      </p>
      <p className="text-center text-sm font-medium leading-5 text-ink-2">
        No need to pick a level. Tell me what’s tricky, answer a few quick questions, and I’ll find a good place to start.
      </p>
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Button onClick={() => goToStep("concerns")}>Type it</Button>
        {aiAvailable ? (
          <Button variant="secondary" onClick={() => goToStep("concerns")}>
            Speak it
          </Button>
        ) : (
          <p className="text-center text-xs font-medium leading-4 text-muted" data-testid="voice-unavailable">
            Voice isn’t available right now. Typing works great.
          </p>
        )}
        <Button variant="ghost" onClick={() => skipConversation()}>
          Skip, start a general grammar check
        </Button>
        <button
          type="button"
          className="mx-auto min-h-11 text-sm font-semibold text-muted underline underline-offset-4"
          onClick={() => {
            skipOnboarding();
            router.replace("/learn");
          }}
        >
          Not now
        </button>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------------- Interpret */

async function interpretGoals(text: string, source: "typed" | "spoken", aiAvailable: boolean): Promise<LearnerGoals> {
  const now = Date.now();
  const skills = listSkills();
  const local = extractGoalsLocally(text, skills);
  if (aiAvailable) {
    const ai = await requestGoals(text);
    if (ai && ai.skillIds.length > 0) {
      return buildGoals({ text, source, goals: ai.goals, skillIds: ai.skillIds, extractedBy: "ai", now });
    }
  }
  return buildGoals({ text, source, goals: local.goals, skillIds: local.skillIds, extractedBy: "local", now });
}

/* ---------------------------------------------------------------- Concerns */

function Concerns({ state, aiAvailable }: { state: StoredState; aiAvailable: boolean }) {
  const text = state.onboarding.draftText;
  const [busy, setBusy] = useState<"idle" | "listening" | "thinking">("idle");
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    setError(null);
    setBusy("thinking");
    saveGoalsForConfirmation(await interpretGoals(text, "typed", aiAvailable));
    setBusy("idle");
  };

  const onAudio = async (audio: Blob) => {
    setError(null);
    setBusy("listening");
    const transcript = await requestTranscription(audio);
    setBusy("idle");
    if (!transcript) {
      setError("I couldn’t turn that into text. Please try again, or type it instead.");
      return;
    }
    setConcernsDraft(transcript, "spoken");
    goToStep("transcript");
  };

  return (
    <Frame testId="onboarding-concerns" expression={busy === "idle" ? "curious" : "thinking"} onBack={() => goToStep("welcome")}>
      <h1 className="text-2xl font-extrabold leading-8 tracking-[-0.3px]">What’s tricky about English for you?</h1>
      <TextField
        label="Tell Migo in your own words"
        multiline
        value={text}
        onChange={(v) => setConcernsDraft(v, "typed")}
        placeholder="For example: I always mix up past tenses…"
        maxLength={500}
        error={error}
        disabled={busy !== "idle"}
      />
      <div className="flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setConcernsDraft(example, "typed")}
            className="min-h-11 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-semibold hover:bg-subtle"
          >
            {example}
          </button>
        ))}
      </div>
      {aiAvailable ? (
        <>
          <VoiceRecorder onAudio={onAudio} disabled={busy !== "idle"} />
          <AiNotice what="voice-and-text" />
        </>
      ) : (
        <p className="text-xs font-medium leading-4 text-muted" data-testid="voice-unavailable">
          Voice isn’t available right now. Typing works great.
        </p>
      )}
      {busy !== "idle" && (
        <p role="status" className="text-sm font-semibold text-ink-2">
          {busy === "listening" ? "Turning your voice into text…" : "Thinking about what you said…"}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <Button onClick={next} disabled={text.trim().length < 2 || busy !== "idle"}>
          Continue
        </Button>
        <Button variant="ghost" onClick={() => skipConversation()} disabled={busy !== "idle"}>
          Skip, start a general grammar check
        </Button>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------- Transcript */

function Transcript({ state, aiAvailable }: { state: StoredState; aiAvailable: boolean }) {
  const text = state.onboarding.draftText;
  const [busy, setBusy] = useState(false);
  return (
    <Frame testId="onboarding-transcript" expression="explaining" onBack={() => goToStep("concerns")}>
      <h1 className="text-2xl font-extrabold leading-8 tracking-[-0.3px]">Did I get that right?</h1>
      <p className="text-sm font-medium leading-5 text-ink-2">
        Here’s what I heard. Fix anything that’s off. Computers sometimes mishear.
      </p>
      <TextField
        label="Your words"
        multiline
        value={text}
        onChange={(v) => setConcernsDraft(v, "spoken")}
        maxLength={500}
        disabled={busy}
      />
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <Button
          disabled={text.trim().length < 2 || busy}
          onClick={async () => {
            setBusy(true);
            saveGoalsForConfirmation(await interpretGoals(text, "spoken", aiAvailable));
            setBusy(false);
          }}
        >
          Looks good
        </Button>
        <Button variant="secondary" onClick={() => goToStep("concerns")} disabled={busy}>
          Record again
        </Button>
      </div>
    </Frame>
  );
}

/* ----------------------------------------------------------------- Confirm */

function Confirm({ state }: { state: StoredState }) {
  const goals = state.goals;
  const items = goals?.goals ?? [];
  return (
    <Frame testId="onboarding-confirm" expression="explaining" onBack={() => goToStep(state.onboarding.draftSource === "spoken" ? "transcript" : "concerns")}>
      <h1 className="text-2xl font-extrabold leading-8 tracking-[-0.3px]">Here’s what I picked up</h1>
      {items.length > 0 ? (
        <>
          <p className="text-sm font-medium leading-5 text-ink-2">
            {goals?.extractedBy === "ai" ? "I understood these areas." : "I matched your words to these areas."} Remove any that aren’t right.
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="Your goals" data-testid="goal-chips">
            {items.map((g) => (
              <li key={g.label} className="flex items-center gap-1 rounded-full bg-brand-soft py-1.5 pl-3.5 pr-1.5 text-sm font-bold text-brand-text">
                {g.label}
                <button
                  type="button"
                  aria-label={`Remove ${g.label}`}
                  onClick={() => g.skillIds.forEach((id) => removeGoalSkill(id))}
                  className="grid size-8 place-items-center rounded-full hover:bg-brand/20"
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="rounded-[20px] border border-line bg-subtle p-4 text-sm font-medium leading-5" data-testid="no-goals">
          I couldn’t pick out a specific area, and that’s completely fine. I’ll run a general grammar check and we’ll find out together.
        </p>
      )}
      <MigoBubble expression="idle">Next: a quick check, about 8 questions. It’s not a test, and you can skip any question.</MigoBubble>
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <Button onClick={() => startQuiz()}>Start the quick check</Button>
        <Button variant="secondary" onClick={() => goToStep("concerns")}>
          Change what I wrote
        </Button>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------- Quiz */

function QuizQuestion({ runId, itemId }: { runId: string; itemId: string }) {
  const item = useMemo(() => diagnosticPool().find((p) => p.id === itemId)!, [itemId]);
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) answerQuizItem(runId, item, gradeDiagnosticAnswer(item, value));
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
      className="flex flex-1 flex-col gap-3"
    >
      <h2 id="question-prompt" className="text-2xl font-semibold leading-[34px] tracking-[-0.25px]">
        {item.question.prompt.split("___").flatMap((part, i, arr) => (i < arr.length - 1 ? [part, <span key={i} role="img" aria-label="blank">____</span>] : [part]))}
      </h2>
      <ExerciseView question={item.question} value={value} disabled={false} onChange={setValue} />
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Button type="submit" disabled={!value.trim()} variant={value.trim() ? "primary" : "secondary"}>
          Next
        </Button>
        <Button variant="secondary" onClick={() => answerQuizItem(runId, item, "skipped")}>
          Skip this one
        </Button>
      </div>
    </form>
  );
}

function Quiz({ state }: { state: StoredState }) {
  const router = useRouter();
  const skills = useMemo(() => listSkills(), []);
  const run = state.diagnosticRuns.find((r) => r.id === state.onboarding.runId) ?? null;

  const item = useMemo(() => (run ? selectNextItem(run, diagnosticPool(), skills) : null), [run, skills]);

  const starting = useRef(false);
  useEffect(() => {
    if (!run) {
      if (!starting.current) {
        starting.current = true;
        startQuiz();
      }
    } else if (!item) goToStep("profile");
  }, [run, item]);

  if (!run || !item) return <div className="min-h-dvh" aria-busy="true" />;
  const answered = run.responses.length;

  return (
    <Frame testId="onboarding-quiz">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Migo expression="thinking" size={48} />
          <div>
            <p className="text-base font-bold leading-6">Quick check · question {answered + 1}</p>
            <p className="text-xs font-medium leading-4 text-ink-2">About 8 questions. Not a test, and you can skip any.</p>
          </div>
        </div>
      </div>
      <QuizQuestion key={item.id} runId={run.id} itemId={item.id} />
      <button
        type="button"
        className="mx-auto min-h-11 text-sm font-semibold text-muted underline underline-offset-4"
        onClick={() => {
          skipOnboarding();
          router.replace("/learn");
        }}
      >
        Skip the check for now
      </button>
    </Frame>
  );
}

/* ----------------------------------------------------------------- Profile */

function Profile({ state }: { state: StoredState }) {
  const learning = useDerivedLearning(state)!;
  const run = state.diagnosticRuns.find((r) => r.id === state.onboarding.runId) ?? null;
  const more = run ? canExtend(run) : false;
  return (
    <Frame testId="onboarding-profile" expression="happy">
      <h1 className="text-2xl font-extrabold leading-8 tracking-[-0.3px]">Here’s what I’m seeing</h1>
      <ProfileSummary profile={learning.profile} />
      {more && (
        <p className="rounded-[20px] border border-line bg-subtle p-4 text-sm font-medium leading-5" data-testid="extend-offer">
          I couldn’t get a clear picture yet. A few more questions would help. Totally optional.
        </p>
      )}
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <Button onClick={() => showRecommendation()}>See my first lesson</Button>
        {more && run && (
          <Button variant="secondary" onClick={() => extendQuiz(run.id)}>
            Answer a few more questions
          </Button>
        )}
        <Button variant="ghost" onClick={() => restartOnboarding("concerns")}>
          Change my goals
        </Button>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------- Recommendation */

function Recommendation({ state, onLeave }: { state: StoredState; onLeave: () => void }) {
  const router = useRouter();
  const learning = useDerivedLearning(state)!;
  const top = learning.top;
  const skill = top ? getCurriculumSkill(top.skillId) : null;
  const lesson = top ? getLesson(top.skillId) : null;

  const begin = () => {
    if (!lesson) return;
    onLeave();
    completeOnboarding();
    startSession(lesson);
    router.push(`/practice/${lesson.id}/session`);
  };

  return (
    <Frame testId="onboarding-recommendation" expression="happy" onBack={() => goToStep("profile")}>
      <h1 className="text-2xl font-extrabold leading-8 tracking-[-0.3px]">Your first lesson</h1>
      {top && skill && lesson ? (
        <section className="rounded-[20px] border border-brand bg-brand-soft p-5" data-testid="first-lesson">
          <p className="text-xs font-bold tracking-[0.6px] text-brand-text">{skill.topic}</p>
          <h2 className="mt-1 text-2xl font-bold leading-8">{lesson.title}</h2>
          <p className="mt-1 text-xs font-medium text-ink-2">
            About {lesson.minutes} minutes · {lesson.questions.length} exercises
          </p>
          <p className="mt-3 text-sm font-medium leading-5 text-ink" data-testid="first-lesson-reason">
            <span className="font-bold">Why this one? </span>
            {top.reason}
          </p>
        </section>
      ) : (
        <p className="text-sm font-medium text-ink-2">No lesson to suggest yet.</p>
      )}
      <p className="text-xs font-medium leading-4 text-muted">
        You can switch to any lesson at any time. This is just where I’d start.
      </p>
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <Button onClick={begin} disabled={!lesson}>
          Start My First Lesson
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onLeave();
            completeOnboarding();
            router.push("/library");
          }}
        >
          Browse all lessons
        </Button>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------- Flow */

export function OnboardingFlow() {
  const router = useRouter();
  const state = usePracticeState();
  const [aiAvailable, setAiAvailable] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    let live = true;
    fetchAiStatus().then((s) => live && setAiAvailable(s.available));
    return () => {
      live = false;
    };
  }, []);

  const status = state?.onboarding.status;
  useEffect(() => {
    if (!status) return;
    if (status === "not_started") beginOnboarding();
    else if ((status === "completed" || status === "skipped") && !leaving.current) router.replace("/learn");
  }, [status, router]);

  if (!state || status === "not_started" || status === "completed" || status === "skipped") {
    return <div className="min-h-dvh" aria-busy="true" />;
  }

  switch (state.onboarding.step) {
    case "welcome":
      return <Welcome aiAvailable={aiAvailable} />;
    case "concerns":
      return <Concerns state={state} aiAvailable={aiAvailable} />;
    case "transcript":
      return <Transcript state={state} aiAvailable={aiAvailable} />;
    case "confirm":
      return <Confirm state={state} />;
    case "quiz":
      return <Quiz state={state} />;
    case "profile":
      return <Profile state={state} />;
    case "recommendation":
      return <Recommendation state={state} onLeave={() => (leaving.current = true)} />;
  }
}
