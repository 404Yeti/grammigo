"use client";

import { useState } from "react";
import type { Question } from "@/types/lesson";
import type { AnswerState } from "@/components/ui/AnswerOption";
import { MigoAudio } from "@/features/voice/MigoAudio";
import { ChoiceExercise } from "./ChoiceExercise";

export function ListeningExercise({ lessonId, question, value, disabled, resultStates, onChange }: {
  lessonId: string; question: Question; value: string; disabled: boolean; resultStates?: Record<string, AnswerState>; onChange: (value: string) => void;
}) {
  const [reading, setReading] = useState(false);
  return <div className="flex flex-col gap-4" data-testid="listening-exercise">
    <MigoAudio lessonId={lessonId} questionId={question.id} kind="listening" />
    <p className="text-sm font-medium leading-6 text-ink-2">Listen, then choose the sentence that matches. Replay whenever you need. If you cannot hear the audio, use the reading alternative.</p>
    {!disabled && !reading && <button type="button" className="min-h-11 w-fit text-sm font-bold text-brand-text underline underline-offset-4" onClick={() => setReading(true)}>Read instead · text alternative</button>}
    {(disabled || reading) && <div className="rounded-2xl border border-line bg-subtle p-4" data-testid="listening-transcript">
      <h2 className="text-sm font-bold">{reading && !disabled ? "Reading alternative" : "What Migo said"}</h2>
      <p className="mt-2 text-base font-medium leading-6">{question.listening?.transcript}</p>
    </div>}
    <ChoiceExercise question={question} value={value} disabled={disabled} resultStates={resultStates} onChange={onChange} />
  </div>;
}
