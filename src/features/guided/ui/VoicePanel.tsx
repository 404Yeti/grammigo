"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import { Migo } from "@/components/mascot/Migo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import type { ExercisePhase } from "@/types/guided";
import { COPY } from "./copy";
import { InfoCard } from "./parts";

const clock = (s: number) => `0:${String(s).padStart(2, "0")}`;

interface VoicePanelProps {
  phase: ExercisePhase;
  /** Microphone opened and recording (not just waiting for the browser's permission prompt). */
  listening: boolean;
  seconds: number;
  explaining: boolean;
  fixing: boolean;
  onTap: () => void;
  onExplainContinue: () => void;
  onStop: () => void;
}

/** The mic area for spoken answers: ready, permission explainer, recording, transcribing. Confirming is a text field in the exercise screen. */
export function VoicePanel({ phase, listening, seconds, explaining, fixing, onTap, onExplainContinue, onStop }: VoicePanelProps) {
  const stopRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase === "recording" && listening) stopRef.current?.focus({ preventScroll: true });
  }, [phase, listening]);

  if (explaining) {
    return (
      <div className="flex flex-col gap-3" data-testid="mic-explainer">
        <InfoCard label={COPY.explainer.label} title={COPY.explainer.title}>
          {COPY.explainer.body}
        </InfoCard>
        <Button onClick={onExplainContinue}>Continue</Button>
      </div>
    );
  }

  if (phase === "recording") {
    return (
      <div className="flex flex-col items-center gap-3 py-2" data-testid="recording-panel">
        <button
          ref={stopRef}
          type="button"
          onClick={onStop}
          disabled={!listening}
          aria-label={listening ? `Stop recording (${seconds} seconds)` : "Waiting for the microphone"}
          className="grid size-[88px] place-items-center rounded-full bg-inverse text-on-inverse ring-4 ring-brand disabled:opacity-60"
        >
          <Square size={26} aria-hidden fill="currentColor" />
        </button>
        <p className="text-sm font-semibold leading-5 text-ink">{listening ? `${COPY.listening} ${clock(seconds)}` : "Waiting for the microphone…"}</p>
        <p className="text-xs font-medium leading-4 text-muted">Tap Stop when you’re done</p>
        <Migo expression="curious" size={80} />
      </div>
    );
  }

  if (phase === "transcribing") {
    return (
      <div className="flex flex-col items-center gap-3 py-2" data-testid="transcribing-panel">
        <span className="grid size-[88px] place-items-center rounded-full bg-subtle text-muted" aria-hidden>
          <Mic size={30} />
        </span>
        <p className="text-sm font-semibold leading-5 text-ink">{COPY.transcribing}</p>
        <p className="text-xs font-medium leading-4 text-muted">Just a moment</p>
        <Migo expression="thinking" size={80} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2.5 py-1" data-testid="mic-ready">
      <button
        type="button"
        onClick={onTap}
        className={cn("flex size-[96px] flex-col items-center justify-center gap-1 rounded-full bg-brand text-ink ring-4 ring-brand-soft hover:bg-brand-600")}
      >
        <Mic size={30} aria-hidden />
        <span className="text-xs font-bold leading-4">{COPY.speakHelp.idle}</span>
      </button>
      <p className="text-xs font-medium leading-4 text-muted">{COPY.speakHelp.limit}</p>
      <MigoBubble expression="encouraging">{fixing ? "Say the whole sentence again." : COPY.speakHelp.migo}</MigoBubble>
    </div>
  );
}
