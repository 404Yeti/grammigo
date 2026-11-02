"use client";

import type { Ref } from "react";
import type { Question } from "@/types/lesson";
import type { AnswerState } from "@/components/ui/AnswerOption";
import { TextField } from "@/components/ui/TextField";
import { ChoiceExercise } from "./ChoiceExercise";
import { SpeakingAnswer } from "@/features/speaking/SpeakingAnswer";
import { TileExercise } from "./TileExercise";

export interface ExerciseViewProps {
  question: Question;
  value: string;
  disabled: boolean;
  error?: string | null;
  resultStates?: Record<string, AnswerState>;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

/** Picks the input method for each exercise type. Rendering only; no grading in here. */
export function ExerciseView({ question, value, disabled, error, resultStates, onChange, inputRef, onBusyChange }: ExerciseViewProps) {
  switch (question.type) {
    case "speaking":
      return <SpeakingAnswer value={value} onChange={onChange} disabled={disabled} error={error} inputRef={inputRef} onBusyChange={onBusyChange} />;
    case "multiple-choice":
    case "multiple-choice-context":
      return (
        <ChoiceExercise
          question={question}
          value={value}
          disabled={disabled}
          resultStates={resultStates}
          onChange={onChange}
        />
      );

    case "fill-blank":
    case "contextual-verb":
      return (
        <TextField
          label="Your answer"
          value={value}
          onChange={onChange}
          placeholder={question.placeholder}
          helper={question.helper}
          error={error}
          disabled={disabled}
          inputRef={inputRef}
          maxLength={120}
        />
      );

    case "sentence-construction":
      return (
        <TileExercise question={question} value={value} disabled={disabled} error={error} onChange={onChange} />
      );

    case "sentence-correction":
    case "sentence-transformation":
    case "short-writing":
      return (
        <TextField
          label="Your answer"
          multiline
          value={value}
          onChange={onChange}
          placeholder={question.placeholder}
          error={error}
          disabled={disabled}
          inputRef={inputRef}
          maxLength={500}
          savedNote
        />
      );
  }
}
