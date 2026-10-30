import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type AnswerState = "default" | "selected" | "correct" | "incorrect";

interface AnswerOptionProps {
  name: string;
  value: string;
  label: string;
  state: AnswerState;
  disabled?: boolean;
  onSelect: () => void;
}

const card: Record<AnswerState, string> = {
  default: "border-line bg-surface hover:bg-subtle",
  selected: "border-brand bg-surface",
  correct: "border-success-border bg-success-soft",
  incorrect: "border-error-border bg-error-soft",
};

/**
 * Selectable answer (radio). Uses a real radio input for keyboard and screen-reader support.
 * Correct / incorrect show an icon and a text label, never colour alone.
 */
export function AnswerOption({ name, value, label, state, disabled, onSelect }: AnswerOptionProps) {
  const checked = state !== "default";
  return (
    <label
      className={cn(
        "relative flex min-h-[60px] cursor-pointer items-center gap-3.5 rounded-[20px] border-[1.5px] px-[18px] py-3.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
        card[state],
        disabled && "cursor-default",
        state === "selected" && "border-2",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border-2",
          state === "default" && "border-line-strong bg-surface",
          state === "selected" && "border-brand bg-surface",
          state === "correct" && "border-success bg-success text-white",
          state === "incorrect" && "border-error bg-error text-white",
        )}
      >
        {state === "selected" && <span className="size-2.5 rounded-full bg-brand" />}
        {state === "correct" && <Check size={14} strokeWidth={3} />}
        {state === "incorrect" && <X size={14} strokeWidth={3} />}
      </span>
      <span className="flex-1 text-lg font-medium leading-7 text-ink">{label}</span>
      {state === "correct" && <span className="text-xs font-bold text-success">Correct</span>}
      {state === "incorrect" && <span className="text-xs font-bold text-error">Not quite</span>}
    </label>
  );
}
