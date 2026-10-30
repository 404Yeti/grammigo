import { X } from "lucide-react";
import { Wordmark } from "@/components/layout/Wordmark";
import { cn } from "@/lib/utils/cn";

interface LessonHeaderProps {
  /** Zero-based index of the current question. */
  current: number;
  total: number;
  onExit: () => void;
}

/** Minimal lesson header: exit, wordmark, 8-step progress and “Question n of 8”. */
export function LessonHeader({ current, total, onExit }: LessonHeaderProps) {
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex h-11 items-center">
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit lesson"
          className="grid size-11 place-items-center rounded-full bg-subtle text-ink hover:bg-sand"
        >
          <X size={18} aria-hidden />
        </button>
        <div className="flex flex-1 justify-center">
          <Wordmark />
        </div>
        <div className="size-11" aria-hidden />
      </div>
      <div
        role="progressbar"
        aria-label="Lesson progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={`Question ${current + 1} of ${total}`}
        className="flex gap-1"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-[3px]",
              i < current ? "bg-inverse" : i === current ? "bg-brand" : "bg-sand",
            )}
          />
        ))}
      </div>
      <p className="text-xs font-medium leading-4 text-ink-2">
        Question {current + 1} of {total}
      </p>
    </header>
  );
}
