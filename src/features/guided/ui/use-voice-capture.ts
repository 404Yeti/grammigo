"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceIssue } from "@/types/guided";

export const MAX_RECORDING_SECONDS = 30;

export type CaptureResult = { ok: true; blob: Blob } | { ok: false; reason: VoiceIssue };

/** Whether this browser can record at all. Checked before a recording is started, never assumed. */
export function voiceSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

function issueFor(error: unknown): VoiceIssue {
  const name = error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" ? "permission_denied" : "failed";
}

/**
 * Push-to-talk capture, capped at 30 s and a low bitrate. Audio stays in memory, goes only to
 * transcription, and is never stored. Every failure is a named VoiceIssue so the screen can say
 * what happened and offer typing; none of them is the learner's mistake.
 */
export function useVoiceCapture() {
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      invalidate();
      discard.current = true;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      release();
    };
  }, [release, invalidate]);

  /** Resolves when the microphone is open (or why it could not be). `onDone` fires once, when recording ends. */
  const start = useCallback(
    async (onDone: (result: CaptureResult) => void): Promise<{ ok: true } | { ok: false; reason: VoiceIssue }> => {
      if (!voiceSupported()) return { ok: false, reason: "unsupported" };
      const currentGeneration = ++generation.current;
      discard.current = false;
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        return { ok: false, reason: issueFor(error) };
      }
      if (currentGeneration !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return { ok: false, reason: "failed" };
      }
      try {
        stream.current = media;
        chunks.current = [];
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
        recorder.current = rec;
        rec.ondataavailable = (e) => {
          if (currentGeneration === generation.current && e.data.size > 0) chunks.current.push(e.data);
        };
        rec.onstop = () => {
          if (currentGeneration !== generation.current) {
            media.getTracks().forEach((track) => track.stop());
            return;
          }
          const type = rec.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks.current, { type });
          const cancelled = discard.current;
          release();
          if (cancelled) return;
          onDone(blob.size > 0 ? { ok: true, blob } : { ok: false, reason: "no_speech" });
        };
        rec.onerror = () => {
          if (currentGeneration !== generation.current) return;
          discard.current = true;
          if (rec.state !== "inactive") rec.stop();
          release();
          onDone({ ok: false, reason: "failed" });
        };
        rec.start();
        setSeconds(0);
        setListening(true);
        timer.current = setInterval(() => {
          setSeconds((s) => {
            if (s + 1 >= MAX_RECORDING_SECONDS && rec.state !== "inactive") rec.stop();
            return s + 1;
          });
        }, 1000);
        return { ok: true };
      } catch {
        release();
        return { ok: false, reason: "failed" };
      }
    },
    [release],
  );

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  /** Throws the recording away without handing anything on. */
  const cancel = useCallback(() => {
    invalidate();
    discard.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
  }, [release, invalidate]);

  return { listening, seconds, start, stop, cancel };
}
