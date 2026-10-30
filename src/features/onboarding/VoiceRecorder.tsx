"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";

const MAX_SECONDS = 30;

type Phase = "idle" | "recording" | "error";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

interface VoiceRecorderProps {
  /** Called with the recorded audio. The parent decides what to do with it (transcribe). */
  onAudio: (audio: Blob) => void;
  disabled?: boolean;
}

/**
 * Push-to-talk recorder, capped at 30 s and a low bitrate (bounded upload size).
 * Audio stays in memory, is sent only for transcription, and is never stored.
 * Always offers a typed fallback via the parent when the microphone is unavailable.
 */
export function VoiceRecorder({ onAudio, disabled }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => cleanup, []);

  const stop = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const start = async () => {
    setMessage(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      setMessage("This browser can’t record audio. You can type instead.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      chunks.current = [];
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
      recorder.current = rec;
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
        cleanup();
        setPhase("idle");
        if (blob.size > 0) onAudio(blob);
        else setMessage("I didn’t catch anything. Try again, or type instead.");
      };
      rec.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      cleanup();
      setPhase("error");
      setMessage("I can’t use the microphone. You can allow it in your browser, or just type instead.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {phase === "recording" ? (
        <Button variant="dark" onClick={stop} aria-label={`Stop recording (${seconds} seconds)`}>
          <Square size={16} aria-hidden fill="currentColor" /> Stop · {seconds}s
        </Button>
      ) : (
        <Button variant="secondary" onClick={start} disabled={disabled}>
          <Mic size={18} aria-hidden /> Speak it
        </Button>
      )}
      <p className="text-xs font-medium leading-4 text-muted">
        {phase === "recording"
          ? "Listening… tap Stop when you’re done (up to 30 seconds)."
          : "I only turn your voice into text. It isn’t used to judge your English, and the recording isn’t saved."}
      </p>
      {message && (
        <p role="alert" className="text-xs font-semibold leading-4 text-error">
          {message}
        </p>
      )}
    </div>
  );
}
