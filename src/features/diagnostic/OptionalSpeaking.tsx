"use client";

import { useState } from "react";
import { SpeakingAnswer } from "@/features/speaking/SpeakingAnswer";
import { Button } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { saveOptionalSpeaking } from "@/features/onboarding/actions";
import { observeFavoritePlace, type OptionalSpeaking as Sample } from "./speaking-schema";

export function OptionalSpeaking({ runId, previous, onDone }: { runId: string; previous?: Sample; onDone: () => void }) {
  const [answer, setAnswer] = useState(previous?.status === "answered" ? previous.answer : "");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const observation = checked ? observeFavoritePlace(answer) : null;
  const save = () => {
    if (!answer.trim() || busy || !observation) return;
    saveOptionalSpeaking(runId, { version: 1, status: "answered", at: Date.now(), questionId: "favorite-place-present-simple", answer: answer.trim(), observation: observation.observation });
    onDone();
  };
  return (
    <section className="flex flex-1 flex-col gap-3 pt-3" data-testid="optional-diagnostic-speaking" aria-labelledby="optional-speaking-prompt">
      <div className="flex justify-center"><GrammarTag style="neutral">Speaking · optional</GrammarTag></div>
      <h1 id="optional-speaking-prompt" className="text-2xl font-semibold leading-[34px] tracking-[-0.25px]">Say one sentence about your favorite place.</h1>
      <p className="text-sm font-medium leading-6 text-ink-2">Use the present simple to describe it. This optional sample stays separate from your quick-check result.</p>
      <SpeakingAnswer value={answer} onChange={setAnswer} disabled={checked} onBusyChange={setBusy} />
      {observation && <div role="status" className="rounded-2xl border border-line-strong bg-subtle p-4 text-sm font-medium leading-6">{observation.message}</div>}
      <p className="text-xs font-medium leading-5 text-muted">Only confirmed text is saved, when you choose Continue. Audio is never saved by Grammigo.</p>
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        {checked ? <>
          <Button onClick={save}>Continue to my results</Button>
          <Button variant="secondary" onClick={() => setChecked(false)}>Try my sentence again</Button>
        </> : <Button onClick={() => setChecked(true)} disabled={!answer.trim() || busy}>Check my sentence</Button>}
        <Button variant="ghost" onClick={() => { saveOptionalSpeaking(runId, { version: 1, status: "skipped", at: Date.now() }); onDone(); }}>Skip speaking</Button>
      </div>
    </section>
  );
}
