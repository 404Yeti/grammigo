"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { LessonHeader } from "@/components/lesson/LessonHeader";
import { ExitDialog } from "@/components/lesson/ExitDialog";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import { MigoAudio } from "@/features/voice/MigoAudio";
import { SpeakingAnswer } from "@/features/speaking/SpeakingAnswer";
import { requestSpeakingFeedback } from "@/features/ai/client";
import { getScopeRevision } from "@/lib/scope/storage-scope";
import type { Session } from "@/types/session";
import { speakingChallenge, CHALLENGE_ID } from "./content";
import { saveChallengeFeedback, updateChallenge } from "./actions";

export function FinalSpeakingChallenge({ session, onFinish, onExit }: { session: Session; onFinish: () => void; onExit: () => void }) {
  const task = speakingChallenge(session.lessonId)!;
  const challenge = session.speakingChallenge!;
  const [revision] = useState(getScopeRevision);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [exit, setExit] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const answer = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { if (challenge.retryUsed) answer.current?.focus(); }, [challenge.retryUsed]);
  useEffect(() => { heading.current?.focus(); return () => controller.current?.abort(); }, []);
  const last = challenge.attempts.at(-1);
  const feedback = last?.feedback;
  const canAnswer = challenge.attempts.length === 0 || (challenge.retryUsed && challenge.attempts.length === 1);
  const change = (draft: string) => updateChallenge(session.id, revision, c => ({ ...c, draft }));

  async function check() {
    if (lock.current || !canAnswer || !challenge.draft.trim() || busy) return;
    lock.current = true;
    setChecking(true);
    const text = challenge.draft.trim();
    const index = challenge.attempts.length;
    // Save before the network call: reload cannot erase a submitted response or reset retry limits.
    updateChallenge(session.id, revision, c => ({ ...c, attempts: [...c.attempts, { text, at: Date.now(), feedback: null }] }));
    const abort = new AbortController();
    controller.current = abort;
    const result = await requestSpeakingFeedback({ skillId: session.lessonId, text }, abort.signal);
    if (abort.signal.aborted) return;
    saveChallengeFeedback(session.id, revision, index, text, result);
    setChecking(false);
    lock.current = false;
  }

  return <div className="mx-auto flex min-h-dvh w-full max-w-[638px] flex-col gap-4 px-6 pb-6 pt-5">
    <LessonHeader current={session.records.length} total={session.records.length + 1} stepText="One final speaking step" onExit={() => setExit(true)} />
    <GrammarTag>Final speaking challenge</GrammarTag>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold leading-[34px] outline-none">{task.prompt}</h1>
    <MigoAudio lessonId={session.lessonId} questionId={CHALLENGE_ID} kind="instruction" autoPlayKey={`challenge:${revision}:${session.id}`} />
    <MigoBubble expression="encouraging">{challenge.retryUsed ? task.hints[0] ?? "Use the target grammar to improve your answer, then try once more." : "One last chance to use this lesson’s grammar in your own words."}</MigoBubble>
    <p className="text-sm leading-6 text-ink-2">Check what we heard before submitting. Misheard words are transcription mistakes, not grammar errors. AI feedback can be uncertain and does not change your exercise score.</p>
    <SpeakingAnswer key={`${session.id}:${challenge.retryUsed}`} value={challenge.draft} onChange={change} onTranscript={change} disabled={!canAnswer || checking} onBusyChange={setBusy} inputRef={answer} />
    {last && <section aria-label="Speaking feedback" aria-live="polite" className="rounded-2xl border border-line bg-subtle p-4 text-sm leading-6">
      <p className="font-bold">{checking ? "Checking your confirmed words…" : feedback?.outcome === "meets_goal" && feedback.confidence !== "low" ? "You used the target grammar." : feedback?.outcome === "needs_work" && feedback.confidence !== "low" ? "A small improvement to try" : "Not verified"}</p>
      <p>{checking ? "Your response is saved. You can finish without waiting." : feedback ? feedback.explanation : "Feedback is unavailable or was interrupted. Your response is saved; you can finish this lesson."}</p>
      {!checking && feedback && (feedback.outcome === "unclear" || feedback.confidence === "low") && <p>Please check whether the transcript matches what you said. Uncertain text is not counted as a grammar error.</p>}
      {!checking && feedback?.confidence !== "low" && feedback?.outcome !== "unclear" && feedback?.suggestedCorrection && <p><strong>Try this pattern: </strong>{feedback.suggestedCorrection}</p>}
      {!checking && !challenge.retryUsed && challenge.attempts.length === 1 && <Button variant="secondary" onClick={() => updateChallenge(session.id, revision, c => ({ ...c, retryUsed: true }))}>Try one guided correction</Button>}
    </section>}
    {canAnswer && <Button disabled={busy || checking || !challenge.draft.trim()} onClick={check}>Check my response</Button>}
    <Button variant={last ? "primary" : "ghost"} onClick={() => {
      controller.current?.abort();
      updateChallenge(session.id, revision, c => ({ ...c, status: c.attempts.length ? "finished" : "skipped" }));
      onFinish();
    }}>{last ? "Finish lesson" : "Skip speaking and finish lesson"}</Button>
    {exit && <ExitDialog onContinue={() => setExit(false)} onSaveAndExit={onExit} />}
  </div>;
}
