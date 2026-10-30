"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";

interface ExitDialogProps {
  onContinue: () => void;
  onSaveAndExit: () => void;
}

/** “Leave this lesson?” Progress is saved automatically; the destructive path never sits in the primary slot. */
export function ExitDialog({ onContinue, onSaveAndExit }: ExitDialogProps) {
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onContinue();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onContinue]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-title"
        aria-describedby="exit-desc"
        className="w-full max-w-[420px] rounded-3xl bg-surface p-6 shadow-xl"
      >
        <h2 id="exit-title" className="text-xl font-bold leading-7">
          Leave this lesson?
        </h2>
        <p id="exit-desc" className="mt-2 text-base font-medium leading-6 text-ink-2">
          Your progress so far will be saved.
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <Button ref={continueRef} onClick={onContinue}>
            Continue Lesson
          </Button>
          <Button variant="secondary" onClick={onSaveAndExit}>
            Save &amp; Exit
          </Button>
        </div>
      </div>
    </div>
  );
}
