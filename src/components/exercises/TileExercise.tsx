"use client";

import { useState } from "react";
import type { Question } from "@/types/lesson";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/utils/cn";

interface TileExerciseProps {
  question: Question;
  value: string;
  disabled: boolean;
  error?: string | null;
  onChange: (value: string) => void;
}

const tileClass =
  "min-h-11 rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-60";

/** Tap words to build a sentence, or type it instead. The draft is always the sentence string. */
export function TileExercise({ question, value, disabled, error, onChange }: TileExerciseProps) {
  const [typing, setTyping] = useState(false);
  const placed = value.split(/\s+/).filter(Boolean);

  // Tiles still in the pool: each placed word uses up one matching tile.
  const remaining = [...(question.tiles ?? [])];
  for (const word of placed) {
    const at = remaining.indexOf(word);
    if (at !== -1) remaining.splice(at, 1);
  }

  const add = (word: string) => onChange([...placed, word].join(" "));
  const removeAt = (index: number) => onChange(placed.filter((_, i) => i !== index).join(" "));

  if (typing) {
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label="Your sentence"
          value={value}
          onChange={onChange}
          placeholder="Type the sentence…"
          error={error}
          disabled={disabled}
          helper="Type the full sentence."
        />
        <button
          type="button"
          onClick={() => setTyping(false)}
          disabled={disabled}
          className="w-fit text-sm font-bold text-brand-text underline underline-offset-4"
        >
          Back to word tiles
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Your sentence"
        data-testid="sentence-area"
        className={cn(
          "flex min-h-[116px] flex-wrap content-start gap-2.5 rounded-[20px] border-[1.5px] bg-surface p-3",
          error ? "border-error-border" : "border-line-strong",
        )}
      >
        {placed.length === 0 && (
          <p className="px-1 py-1 text-base font-medium text-muted">Tap words to build your sentence</p>
        )}
        {placed.map((word, i) => (
          <button
            key={`${word}-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => removeAt(i)}
            aria-label={`${word}, word ${i + 1}. Tap to remove`}
            className={cn(tileClass, "border-brand")}
          >
            {word}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Available words" className="flex flex-wrap gap-2.5">
        {remaining.map((word, i) => (
          <button
            key={`${word}-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => add(word)}
            className={tileClass}
          >
            {word}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-error">
          {error}
        </p>
      )}
      <p className="text-xs font-medium leading-4 text-muted">{question.helper}</p>
      <button
        type="button"
        onClick={() => setTyping(true)}
        disabled={disabled}
        className="w-fit text-sm font-bold text-brand-text underline underline-offset-4"
      >
        Type it instead
      </button>
    </div>
  );
}
