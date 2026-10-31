"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchAiStatus, requestTranscription } from "@/features/ai/client";
import type { GuidedSession } from "@/types/guided";
import { requestOpinion } from "../ai/client";
import type { CycleEffect, CycleEvent } from "../cycle/machine";
import { activeGuidedSession, dispatchGuided, startGuidedSession } from "../store/actions";
import { getGuidedServerSnapshot, getGuidedSnapshot, subscribeGuided } from "../store/store";
import { voiceSupported, useVoiceCapture } from "./use-voice-capture";

/** The online/offline state, so second opinions and voice step aside cleanly instead of failing slowly. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Connects the screens to the pure cycle machine. It owns the only side effects: the AI second
 * opinion, the microphone and transcription. Every result goes back through the machine, and nothing
 * here touches lesson progress, mastery, the profile or recommendations.
 */
export function useGuided() {
  const state = useSyncExternalStore(subscribeGuided, getGuidedSnapshot, getGuidedServerSnapshot);
  const session: GuidedSession | null = state ? activeGuidedSession(state) : null;
  const online = useOnline();
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const aiReady = aiOnline === true && online;
  const capture = useVoiceCapture();
  const [capturing, setCapturing] = useState<"idle" | "requesting" | "listening">("idle");

  const sessionRef = useRef(session);
  const aiRef = useRef(aiReady);
  const onlineRef = useRef(online);
  const opinionAbort = useRef<AbortController | null>(null);
  const voiceToken = useRef(0);
  useEffect(() => {
    sessionRef.current = session;
    aiRef.current = aiReady;
    onlineRef.current = online;
  });

  useEffect(() => {
    let live = true;
    fetchAiStatus().then((s) => live && setAiOnline(s.available));
    return () => {
      live = false;
    };
  }, []);

  // Never leave an AI request or a recording running after the learner leaves.
  useEffect(
    () => () => {
      opinionAbort.current?.abort();
      voiceToken.current += 1;
    },
    [],
  );

  const runOpinion = useCallback((sessionId: string, effect: CycleEffect) => {
    opinionAbort.current?.abort();
    const controller = new AbortController();
    opinionAbort.current = controller;
    requestOpinion({ itemId: effect.itemId, text: effect.text, source: effect.source }, controller.signal).then((result) => {
      if (controller.signal.aborted) return; // skipped, replaced or left: a late answer must not change anything
      dispatchGuided(sessionId, { type: "OPINION", result }, { aiAvailable: aiRef.current });
    });
  }, []);

  const send = useCallback(
    (event: CycleEvent) => {
      const s = sessionRef.current;
      if (!s) return null;
      if (event.type === "SKIP_OPINION" || event.type === "SHOW_ME" || event.type === "ABANDON") opinionAbort.current?.abort();
      const result = dispatchGuided(s.id, event, { aiAvailable: aiRef.current });
      for (const effect of result.effects) runOpinion(s.id, effect);
      return result;
    },
    [runOpinion],
  );

  /** Begins (or restarts) a recording and carries it through transcription to the confirm step. */
  const speak = useCallback(
    async (again = false) => {
      const token = ++voiceToken.current;
      const live = () => token === voiceToken.current;
      send({ type: again ? "REDO_RECORDING" : "START_RECORDING" });
      if (!voiceSupported()) {
        send({ type: "TRANSCRIPT_FAILED", reason: "unsupported" });
        return;
      }
      if (!onlineRef.current) {
        send({ type: "TRANSCRIPT_FAILED", reason: "offline" });
        return;
      }
      setCapturing("requesting");
      const opened = await capture.start(async (done) => {
        if (!live()) return;
        setCapturing("idle");
        if (!done.ok) {
          send({ type: "TRANSCRIPT_FAILED", reason: done.reason });
          return;
        }
        send({ type: "RECORDING_DONE" });
        const text = await requestTranscription(done.blob);
        if (!live()) return; // cancelled or replaced while transcribing
        if (text === null) send({ type: "TRANSCRIPT_FAILED", reason: onlineRef.current ? "failed" : "offline" });
        else send({ type: "TRANSCRIPT_READY", text });
      });
      if (!live()) {
        capture.cancel();
        return;
      }
      if (!opened.ok) {
        setCapturing("idle");
        send({ type: "TRANSCRIPT_FAILED", reason: opened.reason });
        return;
      }
      setCapturing("listening");
    },
    [capture, send],
  );

  const stopRecording = useCallback(() => capture.stop(), [capture]);

  /** Throws away a recording or a transcription in flight and goes back to where the learner was. */
  const cancelVoice = useCallback(() => {
    voiceToken.current += 1;
    capture.cancel();
    setCapturing("idle");
    send({ type: "CANCEL_RECORDING" });
  }, [capture, send]);

  const start = useCallback(() => startGuidedSession(), []);

  return { ready: state !== null, session, send, speak, stopRecording, cancelVoice, start, capture: { state: capturing, seconds: capture.seconds }, online, aiReady, aiKnown: aiOnline !== null, voiceOk: voiceSupported() && aiOnline !== false };
}

export type GuidedController = ReturnType<typeof useGuided>;
