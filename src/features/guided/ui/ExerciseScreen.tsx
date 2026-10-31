"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { WifiOff } from "lucide-react";
import { getGuidedItem } from "@/curriculum/guided";
import { HintCard } from "@/components/feedback/HintCard";
import { Migo } from "@/components/mascot/Migo";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import { Button } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/utils/cn";
import type { GuidedExercise } from "@/types/guided";
import { viewExercise } from "../cycle/messages";
import { COPY, WORD_LEVEL_UNCERTAINTY } from "./copy";
import { Announcer, InfoCard, RetryDots } from "./parts";
import { VoicePanel } from "./VoicePanel";
import type { GuidedController } from "./use-guided";

/** Asks once per visit, and not at all when the browser has already granted the microphone. */
async function needsExplainer(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "prompt";
  } catch {
    return true;
  }
}

const SAME_ANSWER = "That’s the same sentence. Change something, then try again.";

interface Props {
  g: GuidedController;
  ex: GuidedExercise;
  /** The learner chose to pick this up later. */
  onLater: () => void;
  /** From "I'll change mine": go back to editing an answer that could not be checked. */
  editing: boolean;
}

export function ExerciseScreen({ g, ex, onLater, editing }: Props) {
  const item = getGuidedItem(ex.itemId)!;
  const view = viewExercise(ex);
  const transfer = ex.kind === "transfer";
  const [explaining, setExplaining] = useState(false);
  const explained = useRef(false);
  const [sameNote, setSameNote] = useState(false);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const phase = ex.phase;
  const last = ex.attempts.filter((a) => !a.notAnAttempt).at(-1);
  const interactive = phase === "attempting" || phase === "repairing" || phase === "clarifying" || phase === "unverified";
  const spoken = ex.inputMode === "spoken" && interactive;
  const confirming = phase === "confirming";
  const showField = (interactive && !spoken) || confirming || phase === "checking_opinion";

  // A new exercise starts at its question, so keyboard and screen-reader users begin in the right place.
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [ex.id]);

  // Keep the learner's own sentence in the field for a retry (Edit it, then try again).
  const prefilled = useRef("");
  useEffect(() => {
    const key = `${ex.id}:${ex.attempts.length}`;
    if ((phase === "repairing" || phase === "clarifying" || (phase === "unverified" && editing)) && !ex.draft && last && prefilled.current !== key) {
      prefilled.current = key;
      g.send({ type: "EDIT", draft: last.text });
    }
  }, [phase, editing, ex.id, ex.attempts.length, ex.draft, last, g]);

  // After every prompt, focus goes back to the sentence field.
  const focusKey = `${ex.id}|${phase}|${ex.attempts.length}|${ex.rung}|${ex.clarify?.kind ?? ""}|${ex.notice ?? ""}|${editing}`;
  useEffect(() => {
    if (showField && phase !== "checking_opinion") fieldRef.current?.focus({ preventScroll: true });
  }, [focusKey, showField, phase]);

  const submit = () => {
    setSameNote(false);
    if (confirming) {
      const r = g.send({ type: "CONFIRM_TRANSCRIPT" });
      if (r?.rejected === "unchanged") setSameNote(true);
      return;
    }
    const r = g.send({ type: "SUBMIT" });
    if (r?.rejected === "unchanged") setSameNote(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (ex.draft.trim()) submit();
    }
  };

  const onTapMic = async () => {
    if (!explained.current && (await needsExplainer())) {
      setExplaining(true);
      return;
    }
    explained.current = true;
    void g.speak();
  };
  const onExplainContinue = () => {
    explained.current = true;
    setExplaining(false);
    void g.speak();
  };
  const typeInstead = () => {
    setExplaining(false);
    if (ex.phase === "recording" || ex.phase === "transcribing" || ex.phase === "confirming") g.cancelVoice();
    g.send({ type: "SET_MODE", mode: "typed" });
  };

  const hasDraft = ex.draft.trim().length > 0;
  const lastRung = ex.rung >= 3 ? view.ladder.hint2 : ex.rung === 2 ? view.ladder.hint1 : view.ladder.notice;

  const announcement = [
    phase === "recording" ? (g.capture.state === "listening" ? "Recording. Tap Stop when you’re done." : "Waiting for the microphone.") : null,
    phase === "transcribing" ? COPY.transcribing : null,
    confirming ? `${COPY.confirm.title} ${ex.draft}` : null,
    phase === "checking_opinion" ? COPY.checking.title : null,
    view.voiceMessage,
    sameNote ? SAME_ANSWER : null,
    view.neutral,
    interactive && !view.neutral ? lastRung : null,
  ]
    .filter(Boolean)
    .join(" ");

  const noticeTitle = ex.clarify || ex.notice ? null : "Take another look";
  const migoLine = phase === "repairing" || phase === "clarifying" ? COPY.repairMigo[Math.min(ex.retriesUsed, 2)] : transfer && ex.attempts.length > 0 ? COPY.transferNudgeMigo : COPY.attemptMigo;

  if (phase === "offer_show_me") {
    return (
      <div className="flex flex-1 flex-col gap-4" data-testid="offer-show-me">
        <Announcer message={view.neutral ?? ""} />
        <div className="flex justify-center pt-2">
          <Migo expression="encouraging" size={140} />
        </div>
        <InfoCard tone="warm" title="Let’s look at it together">
          {view.neutral}
        </InfoCard>
        <RetryDots used={ex.retriesUsed} total={3} />
        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Button onClick={() => g.send({ type: "SHOW_ME" })}>Show me</Button>
          <Button variant="ghost" onClick={onLater}>
            Come back later
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3.5">
      <Announcer message={announcement} />

      {!g.online && (
        <p className="flex items-start gap-2 rounded-[20px] border border-line-strong bg-warning-soft px-4 py-3 text-sm font-medium leading-5 text-warning-text" data-testid="offline-banner">
          <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden /> {COPY.offline}
        </p>
      )}

      <GrammarTag className="w-fit">
        {COPY.tag} · {transfer ? COPY.newSituation : COPY.fixIt}
      </GrammarTag>
      <h1 ref={headingRef} tabIndex={-1} className="text-[28px] font-extrabold leading-9 tracking-[-0.4px] outline-none" data-testid="guided-question">
        {item.question}
      </h1>
      <div className="rounded-2xl bg-subtle px-4 py-3.5" data-testid="guided-situation">
        <p className="text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">Situation</p>
        <p className="mt-0.5 text-base font-medium leading-6">{item.situation}</p>
      </div>

      {/* How to answer */}
      {interactive && (
        <div role="group" aria-label="How do you want to answer?" className="inline-flex w-fit rounded-full bg-subtle p-1">
          {(["typed", "spoken"] as const).map((mode) => {
            const disabled = mode === "spoken" && !g.voiceOk;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={ex.inputMode === mode}
                disabled={disabled}
                onClick={() => {
                  setExplaining(false);
                  g.send({ type: "SET_MODE", mode });
                }}
                className={cn("min-h-12 rounded-full px-5 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted", ex.inputMode === mode ? "bg-surface text-ink shadow-sm" : "text-ink-2")}
              >
                {mode === "typed" ? "Type" : "Speak"}
              </button>
            );
          })}
        </div>
      )}
      {interactive && !g.voiceOk && g.aiKnown && (
        <p className="text-xs font-medium leading-4 text-muted" data-testid="voice-off-note">
          {COPY.voiceUnavailableOnline}
        </p>
      )}

      {/* Notice, hints and neutral messages: calm, never error red */}
      {!confirming && ex.rung >= 1 && view.ladder.notice && !view.neutral && (
        <InfoCard label="Notice" title={noticeTitle ?? undefined} testId="notice-card">
          {view.ladder.notice}
        </InfoCard>
      )}
      {!confirming && view.ladder.hint1 && <HintCard index={1} total={2} text={view.ladder.hint1} />}
      {!confirming && view.ladder.hint2 && <HintCard index={2} total={2} text={view.ladder.hint2} />}
      {view.neutral && (
        <InfoCard tone={phase === "clarifying" ? "info" : "neutral"} label={phase === "clarifying" ? "Notice" : undefined} testId="neutral-card">
          {view.neutral}
        </InfoCard>
      )}
      {sameNote && (
        <InfoCard tone="info" testId="same-note">
          {SAME_ANSWER}
        </InfoCard>
      )}
      {view.voiceMessage && (
        <InfoCard tone="neutral" label="Voice" testId="voice-message">
          {view.voiceMessage}
        </InfoCard>
      )}
      {ex.voiceIssue === "permission_denied" && (
        <InfoCard label={COPY.micHelp.label} title={COPY.micHelp.title} testId="mic-help">
          {COPY.micHelp.body}
        </InfoCard>
      )}
      {confirming && (
        <>
          <h2 className="text-2xl font-extrabold leading-8">{ex.attempts.length > 0 ? COPY.confirm.fixTitle : COPY.confirm.title}</h2>
          <p className="text-sm font-medium leading-5 text-ink-2">{COPY.confirm.body}</p>
          {WORD_LEVEL_UNCERTAINTY && ex.pendingTranscript && ex.pendingTranscript.lowConfidenceWords.length > 0 && (
            <InfoCard tone="warm" label={ex.pendingTranscript.lowConfidenceWords.length === 1 ? COPY.unsure.label : COPY.unsure.unsureMany} testId="unsure-words">
              <span className="font-bold">“{ex.pendingTranscript.lowConfidenceWords.join("”, “")}”</span> {COPY.unsure.body}
            </InfoCard>
          )}
        </>
      )}

      {/* Spoken: the mic area */}
      {(spoken || phase === "recording" || phase === "transcribing") && (
        <VoicePanel
          phase={phase}
          listening={g.capture.state === "listening"}
          seconds={g.capture.seconds}
          explaining={explaining}
          fixing={ex.attempts.length > 0}
          onTap={onTapMic}
          onExplainContinue={onExplainContinue}
          onStop={g.stopRecording}
        />
      )}

      {/* Typed (and transcript) field */}
      {showField && (
        <TextField
          label={confirming ? (ex.attempts.length > 0 ? "What I heard (your new try)" : "What I heard") : "Your sentence"}
          value={ex.draft}
          onChange={(draft) => {
            setSameNote(false);
            g.send(confirming ? { type: "EDIT_TRANSCRIPT", text: draft } : { type: "EDIT", draft });
          }}
          onKeyDown={onKeyDown}
          multiline
          maxLength={300}
          placeholder="Type your sentence…"
          helper={confirming ? COPY.confirm.hint : ex.attempts.length > 0 ? COPY.editThenTry : COPY.oneSentence}
          helperInsteadOfCount
          disabled={phase === "checking_opinion"}
          inputRef={fieldRef}
        />
      )}

      {phase === "checking_opinion" && (
        <InfoCard label="Second opinion" title={COPY.checking.title} testId="checking-card">
          {COPY.checking.body}
        </InfoCard>
      )}

      {ex.retriesUsed > 0 && phase !== "resolved" && <RetryDots used={ex.retriesUsed} total={view.retriesLeft + ex.retriesUsed} />}

      {phase !== "recording" && phase !== "transcribing" && !explaining && (
        <MigoBubble expression={phase === "checking_opinion" ? "thinking" : phase === "repairing" ? "encouraging" : "curious"}>
          {phase === "checking_opinion" ? COPY.checking.migo : confirming ? COPY.confirm.migo : migoLine}
        </MigoBubble>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        {confirming && (
          <>
            <Button onClick={submit} disabled={!hasDraft}>
              Looks right — check it
            </Button>
            <Button variant="secondary" onClick={() => void g.speak(true)}>
              Say it again
            </Button>
          </>
        )}
        {phase === "recording" && (
          <>
            <Button variant="dark" onClick={g.stopRecording} disabled={g.capture.state !== "listening"}>
              Stop
            </Button>
            <Button variant="secondary" onClick={g.cancelVoice}>
              Cancel
            </Button>
          </>
        )}
        {phase === "transcribing" && (
          <Button variant="secondary" onClick={typeInstead}>
            Type instead
          </Button>
        )}
        {phase === "checking_opinion" && (
          <Button variant="secondary" onClick={() => g.send({ type: "SKIP_OPINION" })}>
            Skip the check
          </Button>
        )}
        {interactive && !explaining && (
          <>
            {spoken ? (
              <Button variant="secondary" onClick={typeInstead}>
                Type instead
              </Button>
            ) : (
              <Button onClick={submit} disabled={!hasDraft}>
                {ex.attempts.length > 0 && phase !== "attempting" ? "Try again" : "Check"}
              </Button>
            )}
            {!spoken && ex.voiceIssue && ex.voiceIssue !== "unsupported" && g.voiceOk && (
              <Button variant="secondary" onClick={() => void g.speak()}>
                Try speaking again
              </Button>
            )}
            {view.canRequestHint && (
              <Button variant="secondary" onClick={() => g.send({ type: "REQUEST_HINT" })}>
                Another hint
              </Button>
            )}
          </>
        )}
        {view.canShowMe && phase !== "recording" && !explaining && (
          <Button variant="ghost" onClick={() => g.send({ type: "SHOW_ME" })}>
            Show me
          </Button>
        )}
        {explaining && (
          <Button variant="secondary" onClick={typeInstead}>
            Not now, type instead
          </Button>
        )}
      </div>
    </div>
  );
}
