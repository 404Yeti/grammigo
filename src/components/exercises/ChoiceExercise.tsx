import type { Question } from "@/types/lesson";
import { AnswerOption, type AnswerState } from "@/components/ui/AnswerOption";

interface ChoiceExerciseProps {
  question: Question;
  value: string;
  disabled: boolean;
  /** Overrides applied while feedback is showing (correct / incorrect marks). */
  resultStates?: Record<string, AnswerState>;
  onChange: (optionId: string) => void;
}

export function ChoiceExercise({ question, value, disabled, resultStates, onChange }: ChoiceExerciseProps) {
  return (
    <div role="radiogroup" aria-labelledby="question-prompt" className="flex flex-col gap-3">
      {question.options?.map((option) => {
        const state: AnswerState =
          resultStates?.[option.id] ?? (value === option.id ? "selected" : "default");
        return (
          <AnswerOption
            key={option.id}
            name={question.id}
            value={option.id}
            label={option.label}
            state={state}
            disabled={disabled}
            onSelect={() => onChange(option.id)}
          />
        );
      })}
    </div>
  );
}
