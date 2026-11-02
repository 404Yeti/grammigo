"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Migo } from "@/components/mascot/Migo";
import { fetchAiStatus, requestTranscription } from "@/features/ai/client";
import { useVoiceCapture } from "@/features/guided/ui/use-voice-capture";
import type { VoiceIssue } from "@/types/guided";

type Phase = "ready" | "permission" | "recording" | "transcribing" | "review" | "typing";
const ISSUES: Record<VoiceIssue, string> = {
  permission_denied: "Microphone access was denied. You can allow it in your browser, or type instead.",
  unsupported: "This browser cannot record audio. You can type your answer instead.",
  no_speech: "We couldn’t hear an answer. Record again or type instead.",
  timeout: "The microphone or transcription took too long. Try again or type instead.",
  offline: "You’re offline. Your lesson still works: type your answer instead.",
  failed: "We couldn’t turn that recording into text. Record again or type instead.",
};

export function SpeakingAnswer({ value, onChange, disabled, error, inputRef, onBusyChange }: {
  value: string; onChange: (text: string) => void; disabled: boolean; error?: string | null;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>; onBusyChange?: (busy: boolean) => void;
}) {
  const capture = useVoiceCapture();
  const [phase, setPhase] = useState<Phase>(value ? "typing" : "ready");
  const [issue, setIssue] = useState<VoiceIssue | null>(null);
  const [transcript, setTranscript] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const permissionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const busy = ["permission", "recording", "transcribing", "review"].includes(phase);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    let live = true;
    fetchAiStatus().then((status) => { if (live) setAvailable(status.available); });
    return () => { live = false; };
  }, []);
  const cancelCapture = capture.cancel;
  useEffect(() => () => {
    generation.current++;
    abort.current?.abort();
    if (permissionTimer.current) clearTimeout(permissionTimer.current);
    cancelCapture();
    onBusyChange?.(false);
  }, [cancelCapture, onBusyChange]);
  useEffect(() => { if (phase === "review") transcriptRef.current?.focus(); }, [phase]);

  function cancel(next: Phase = "ready") {
    generation.current++;
    abort.current?.abort();
    if (permissionTimer.current) clearTimeout(permissionTimer.current);
    capture.cancel();
    setPhase(next);
  }
  async function record() {
    if (disabled || busy) return;
    if (navigator.onLine === false) { setIssue("offline"); return; }
    setIssue(null);
    const current = ++generation.current;
    setPhase("permission");
    permissionTimer.current = setTimeout(() => {
      if (current !== generation.current) return;
      cancel();
      setIssue("timeout");
    }, 10_000);
    const started = await capture.start(async (result) => {
      if (current !== generation.current) return;
      if (permissionTimer.current) clearTimeout(permissionTimer.current);
      if (!result.ok) { setIssue(result.reason); setPhase("ready"); return; }
      setPhase("transcribing");
      const controller = new AbortController();
      abort.current = controller;
      const text = await requestTranscription(result.blob, controller.signal);
      if (current !== generation.current) return;
      if (!text?.trim()) { setIssue(navigator.onLine === false ? "offline" : "failed"); setPhase("ready"); return; }
      setTranscript(text.trim().slice(0, 500));
      setPhase("review");
    });
    if (current !== generation.current) return;
    if (permissionTimer.current) clearTimeout(permissionTimer.current);
    if (!started.ok) { setIssue(started.reason); setPhase("ready"); }
    else setPhase("recording");
  }

  return (
    <div className="flex flex-col gap-3" data-testid="speaking-answer">
      {!disabled && <p className="text-sm font-medium leading-5 text-ink-2">We check the grammar in your confirmed words, never your accent or pronunciation.</p>}
      {issue && <div className="flex items-center gap-3"><Migo expression="confused" size={66} /><p role="alert" className="rounded-2xl border border-line-strong bg-subtle p-4 text-sm leading-6">{ISSUES[issue]}</p></div>}
      {phase === "review" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-subtle p-4">
          <TextField label="What we heard" multiline value={transcript} onChange={setTranscript} inputRef={transcriptRef} maxLength={500} helper="Fix anything we heard incorrectly before checking grammar." helperInsteadOfCount />
          <Button disabled={!transcript.trim()} onClick={() => { onChange(transcript.trim()); setPhase("typing"); }}>Use this transcript</Button>
          <Button variant="ghost" onClick={() => { cancel(); setTranscript(""); }}>Record again</Button>
        </div>
      ) : phase === "permission" || phase === "recording" || phase === "transcribing" ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] bg-subtle p-5" role="status">
          {phase === "recording" ? <>
            <Button onClick={capture.stop} fullWidth={false} variant="dark"><Square size={24} aria-hidden /> Stop recording</Button>
            <p className="text-sm font-semibold">Recording… {capture.seconds} / 30 seconds</p>
          </> : <p className="text-sm font-semibold">{phase === "permission" ? "Waiting for the microphone…" : "Turning your recording into text…"}</p>}
          <Migo expression={phase === "recording" ? "listening" : "thinking"} size={80} />
          <Button variant="ghost" onClick={() => cancel("typing")}>Cancel and type instead</Button>
        </div>
      ) : null}
      {(phase === "typing" || disabled) && <TextField label="Your answer" multiline value={value} onChange={onChange} disabled={disabled} error={error} inputRef={inputRef} maxLength={500} savedNote />}
      {!disabled && !busy && <>
        <div className="flex justify-center">
          <Button onClick={record} disabled={available !== true} fullWidth={false}><Mic size={24} aria-hidden />{value ? "Record again" : "Record an answer"}</Button>
        </div>
        <p className="text-center text-xs font-medium leading-5 text-muted">{available === false ? "Recording is unavailable right now. You can complete this exercise by typing." : "Up to 30 seconds. Tap to start, then tap Stop."}</p>
        <p className="text-xs font-medium leading-5 text-muted">Audio is sent to OpenAI only for transcription. Grammigo does not store audio. You review the text before grammar is checked.</p>
      </>}
      {!disabled && phase !== "typing" && !busy && <Button variant="ghost" onClick={() => setPhase("typing")}>Type instead</Button>}
    </div>
  );
}
