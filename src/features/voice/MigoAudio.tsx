"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { speechText, type SpeechRequest } from "./content";
import { claimAutomaticSpeech } from "./events";
import { stopMigoAudio, takeMigoAudio } from "./player";
import { setMigoMuted, useMigoMuted } from "./preference";

const audioCache = new Map<string, string>();
const MAX_BYTES = 256_000;
function remember(key: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  audioCache.set(key, url);
  // At most eight public authored clips, in memory only. Never cache learner responses.
  while (audioCache.size > 8) {
    const oldest = audioCache.keys().next().value!;
    URL.revokeObjectURL(audioCache.get(oldest)!);
    audioCache.delete(oldest);
  }
  return url;
}

type AudioInput = SpeechRequest & { autoPlayKey?: string };
export function MigoAudio(input: AudioInput) {
  if (process.env.NEXT_PUBLIC_MIGO_VOICE !== "true") return null;
  return <AudioPreference input={input} />;
}
function AudioPreference({ input }: { input: AudioInput }) {
  const muted = useMigoMuted();
  return <AudioControl key={`${input.lessonId}:${input.questionId}:${input.kind}:${input.hintIndex ?? 0}:${muted}`} input={input} muted={muted} />;
}
function AudioControl({ input, muted }: { input: AudioInput; muted: boolean }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "playing" | "failed">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const { autoPlayKey, ...requestInput } = input;
  const body = JSON.stringify(requestInput);
  const short = ["positive", "supportive", "celebration"].includes(input.kind);
  const spokenText = short ? speechText(requestInput) : null;
  const key = short ? `short:${spokenText}` : body;
  const owner = useRef(Symbol("migo-audio"));

  const stop = useCallback(() => {
    generation.current++;
    request.current?.abort();
    stopMigoAudio(owner.current);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const play = useCallback(async () => {
    if (muted || status === "loading") return;
    const current = ++generation.current;
    setStatus("loading");
    let url = audioCache.get(key);
    try {
      if (!url) {
        const controller = new AbortController();
        request.current = controller;
        const timer = setTimeout(() => controller.abort(), 18_000);
        try {
          const response = await fetch("/api/ai/tts", {
            method: "POST", headers: { "Content-Type": "application/json" }, body,
            signal: controller.signal, cache: "no-store",
          });
          if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("unavailable");
          const blob = await response.blob();
          if (!blob.size || blob.size > MAX_BYTES) throw new Error("invalid_audio");
          if (current !== generation.current) return;
          url = remember(key, blob);
        } finally { clearTimeout(timer); }
      }
      if (current !== generation.current) return;
      stopMigoAudio(owner.current);
      const player = takeMigoAudio(owner.current, url);
      audio.current = player;
      player.onended = () => { if (current === generation.current) setStatus("ready"); };
      player.onerror = () => { if (current === generation.current) setStatus("failed"); };
      // Browser-denied autoplay offers explicit replay; learning never waits for audio.
      try { await player.play(); if (current === generation.current) setStatus("playing"); }
      catch { if (current === generation.current) setStatus("ready"); }
    } catch {
      if (current === generation.current) setStatus("failed");
    }
  }, [muted, status, key, body]);

  useEffect(() => {
    let live = true;
    // Deferring avoids consuming the one-shot event during Strict Mode’s discarded setup.
    void Promise.resolve().then(() => {
      if (live && autoPlayKey && claimAutomaticSpeech(autoPlayKey) && !muted) void play();
    });
    return () => { live = false; };
  }, [autoPlayKey, muted, play]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3" data-testid="migo-audio">
      {spokenText && <p className="text-sm font-medium leading-6" data-testid="migo-spoken-text">{spokenText}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" fullWidth={false} disabled={muted || status === "loading"} onClick={play}>
          {status === "ready" || status === "playing" ? <RotateCcw size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
          {status === "loading" ? "Preparing audio…" : status === "ready" || status === "playing" ? "Replay Migo" : "Listen to Migo"}
        </Button>
        <Button variant="ghost" fullWidth={false} onClick={() => { stop(); setStatus("idle"); setMigoMuted(!muted); }}>
          {muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}{muted ? "Unmute Migo" : "Mute Migo"}
        </Button>
      </div>
      <p className="text-xs font-medium leading-5 text-muted">Migo’s voice is AI-generated. Audio is optional; everything is available in writing.</p>
      <p role="status" className="text-xs font-medium leading-5 text-ink-2">
        {muted ? "Migo is muted on this device." : status === "failed" ? "Audio is unavailable. You can keep learning without it." : status === "ready" ? "Audio is ready. Tap replay if your browser paused playback." : status === "playing" ? "Playing. Replay or mute whenever you like." : ""}
      </p>
    </div>
  );
}
