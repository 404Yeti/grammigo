"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExitDialog } from "@/components/lesson/ExitDialog";
import { LessonHeader } from "@/components/lesson/LessonHeader";
import { currentExercise } from "../cycle/machine";
import { COPY, STEPS } from "./copy";
import { ExerciseScreen } from "./ExerciseScreen";
import { ResolvedView, CantCheckView, Summary, TransferIntro } from "./Stages";
import { useGuided } from "./use-guided";

/** Fix it with Migo: Attempt → Notice → Correct → Understand → Apply, on the pure cycle machine. */
export function GuidedScreen({ lessonId }: { lessonId: string }) {
  const g = useGuided();
  const router = useRouter();
  const leaving = useRef(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [reason, setReason] = useState<{ key: string; open: boolean }>({ key: "", open: false });
  const [changing, setChanging] = useState<string | null>(null);

  const session = g.session;
  const ex = session ? currentExercise(session) : null;

  // A visit starts the activity, or resumes the one in progress (a refresh never forks the learner's place).
  useEffect(() => {
    if (g.ready && !session && !leaving.current) g.start();
  }, [g, session]);

  // The reason view belongs to one finished exercise: it closes by itself when the exercise moves on.
  const reasonKey = ex ? `${ex.id}:${ex.phase}` : "";
  const reasonOpen = reason.key === reasonKey && reason.open;
  const setReasonOpen = (open: boolean) => setReason({ key: reasonKey, open });

  if (!session || !ex) return <div className="min-h-dvh" aria-busy="true" />;

  const leave = () => {
    leaving.current = true;
    router.push(`/practice/${lessonId}`);
  };
  const finish = (again: boolean) => {
    g.send({ type: "FINISH" });
    if (again) {
      g.start();
      return;
    }
    leave();
  };

  const stage = session.stage;
  const stepIndex = stage === "transfer_intro" || stage === "transfer" ? 4 : ex.phase === "resolved" ? (reasonOpen ? 3 : 2) : ex.category || ex.attempts.some((a) => a.verdict === "incorrect") ? 1 : 0;
  const editingUnverified = changing === ex.id;

  let body;
  if (stage === "summary") body = <Summary session={session} onBack={() => finish(false)} onAgain={() => finish(true)} />;
  else if (stage === "transfer_intro") body = <TransferIntro g={g} />;
  else if (ex.phase === "resolved") body = <ResolvedView g={g} ex={ex} reasonOpen={reasonOpen} onReason={setReasonOpen} />;
  else if (ex.phase === "unverified" && !editingUnverified) body = <CantCheckView g={g} ex={ex} onChange={() => setChanging(ex.id)} />;
  else body = <ExerciseScreen g={g} ex={ex} onLater={leave} editing={editingUnverified} />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col px-4 pb-8 pt-5" data-testid="guided-screen" data-stage={stage}>
      {stage !== "summary" && (
        <LessonHeader
          current={stepIndex}
          total={STEPS.length}
          onExit={() => setExitOpen(true)}
          stepText={`Step ${stepIndex + 1} of ${STEPS.length} · ${STEPS[stepIndex]}`}
          progressLabel="Fix it with Migo progress"
          exitLabel="Leave Fix it with Migo"
        />
      )}
      <main className="flex flex-1 flex-col px-2 pt-3">{body}</main>
      {exitOpen && <ExitDialog copy={COPY.exit} onContinue={() => setExitOpen(false)} onSaveAndExit={leave} />}
    </div>
  );
}
