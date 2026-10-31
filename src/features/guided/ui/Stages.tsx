"use client";

import { useEffect, useRef } from "react";
import { Migo } from "@/components/mascot/Migo";
import { MigoBubble } from "@/components/mascot/MigoBubble";
import { Button } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import type { GuidedExercise, GuidedSession } from "@/types/guided";
import { NEUTRAL, viewExercise } from "../cycle/messages";
import { getGuidedItem } from "@/curriculum/guided";
import { CONTRAST, COPY, RESOLVED, type Contrast } from "./copy";
import { Announcer, InfoCard, OutcomeChip } from "./parts";
import type { GuidedController } from "./use-guided";

/** Picks the contrast that fits what the learner just worked on, or none when it would not help (verb-form mistakes). */
export function contrastFor(ex: GuidedExercise): Contrast | null {
  if (ex.category === "participle_form") return null;
  if (ex.category === "since_for_confusion") return CONTRAST.sinceFor;
  if (ex.category === "since_without_perfect") return CONTRAST.unfinished;
  if (ex.category === "pp_with_finished_time") return CONTRAST.finished;
  const frame = getGuidedItem(ex.itemId)?.frame;
  return frame === "finished" ? CONTRAST.finished : frame === "unfinished" ? CONTRAST.unfinished : frame === "experience" ? CONTRAST.experience : null;
}

function ContrastLines({ contrast }: { contrast: Contrast | null }) {
  if (!contrast) return null;
  return (
    <span className="mt-3 block rounded-xl bg-surface px-3 py-2.5" data-testid="contrast">
      <span className="block text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">{contrast.label}</span>
      {contrast.lines.map((l) => (
        <span key={l} className="mt-1 block text-sm font-medium leading-5 text-ink">
          {l}
        </span>
      ))}
    </span>
  );
}

const lastCounted = (ex: GuidedExercise) => ex.attempts.filter((a) => !a.notAnAttempt).at(-1) ?? null;

/** The end of one exercise: an honest outcome chip, a calm message, and the reason on request. */
export function ResolvedView({ g, ex, reasonOpen, onReason }: { g: GuidedController; ex: GuidedExercise; reasonOpen: boolean; onReason: (open: boolean) => void }) {
  const outcome = ex.outcome!;
  const view = viewExercise(ex);
  const transfer = ex.kind === "transfer";
  const kind = outcome.kind;
  const sentence = lastCounted(ex)?.text ?? null;
  const copy = RESOLVED[kind];
  const next = transfer ? "See my summary" : "Continue";
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => continueRef.current?.focus({ preventScroll: true }), [reasonOpen, ex.id]);

  const heading = reasonOpen ? "Why this works" : copy.title;
  const announce = reasonOpen ? `${heading}. ${view.reason}` : [copy.title, copy.body, kind === "shown" ? view.modelAnswer : sentence].filter(Boolean).join(" ");
  const canExplain = kind === "first_try" || kind === "self_corrected" || kind === "hint_assisted";

  return (
    <div className="flex flex-1 flex-col gap-3.5" data-testid="resolved" data-outcome={kind}>
      <Announcer message={announce} />
      {reasonOpen ? (
        <InfoCard label="Why this works" testId="reason-card">
          {view.reason}
          <ContrastLines contrast={contrastFor(ex)} />
        </InfoCard>
      ) : kind === "shown" ? (
        <>
          <InfoCard tone="neutral" label="One way to say it" chip={<OutcomeChip kind={kind} />} testId="outcome-card">
            <span className="text-2xl font-extrabold leading-8 text-ink" data-testid="model-answer">
              {view.modelAnswer}
            </span>
          </InfoCard>
          <InfoCard label="Why" testId="reason-card">
            {view.reason}
            <ContrastLines contrast={contrastFor(ex)} />
          </InfoCard>
        </>
      ) : kind === "unverified" ? (
        <>
          <InfoCard tone="warm" label={COPY.notCounted.label} chip={<OutcomeChip kind={kind} />} title={copy.title} testId="outcome-card">
            {NEUTRAL.unverified.replace(/^I can’t judge this one for sure\.\s*/, "")}
          </InfoCard>
          {sentence && (
            <InfoCard tone="neutral" label={COPY.notCounted.mine}>
              <span className="text-lg font-semibold text-ink">{sentence}</span>
              <span className="mt-3 block text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">{COPY.notCounted.model}</span>
              <span className="text-lg font-semibold text-ink">{view.modelAnswer}</span>
            </InfoCard>
          )}
        </>
      ) : (
        <InfoCard tone="success" label={transfer ? "New situation" : kind === "first_try" ? "Your sentence" : "Your new sentence"} chip={<OutcomeChip kind={kind} />} title={copy.title} testId="outcome-card">
          <p>{copy.body}</p>
          {sentence && <p className="mt-2 text-lg font-semibold text-ink">“{sentence}”</p>}
        </InfoCard>
      )}

      <MigoBubble expression={kind === "unverified" ? "curious" : kind === "shown" ? "explaining" : "happy"}>{copy.migo}</MigoBubble>

      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Button ref={continueRef} onClick={() => g.send({ type: "CONTINUE" })}>
          {reasonOpen && !transfer ? "Try it in a new situation" : next}
        </Button>
        {canExplain && (
          <Button variant="ghost" onClick={() => onReason(!reasonOpen)} aria-expanded={reasonOpen}>
            {reasonOpen ? "Back" : "Why does this fit?"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** An answer that could not be judged for sure: nothing counted, nothing held against the learner. */
export function CantCheckView({ g, ex, onChange }: { g: GuidedController; ex: GuidedExercise; onChange: () => void }) {
  const view = viewExercise(ex);
  const sentence = lastCounted(ex)?.text ?? null;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), [ex.id]);
  return (
    <div className="flex flex-1 flex-col gap-3.5" data-testid="cant-check">
      <Announcer message={`${RESOLVED.unverified.title}. ${view.neutral ?? ""}`} />
      <InfoCard tone="warm" label={COPY.notCounted.label} chip={<span className="inline-flex rounded-full bg-subtle px-2.5 py-1 text-xs font-bold">{COPY.notCounted.chip}</span>} title={RESOLVED.unverified.title}>
        {view.neutral}
      </InfoCard>
      <InfoCard tone="neutral" label={COPY.notCounted.mine}>
        {sentence && <span className="text-lg font-semibold text-ink">{sentence}</span>}
        <span className="mt-3 block text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">{COPY.notCounted.model}</span>
        <span className="text-lg font-semibold text-ink">{view.modelAnswer}</span>
      </InfoCard>
      <MigoBubble expression="curious">{RESOLVED.unverified.migo}</MigoBubble>
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Button ref={ref} onClick={onChange}>
          I’ll change mine
        </Button>
        <Button variant="secondary" onClick={() => g.send({ type: "ACCEPT_AS_IS" })}>
          Mine says the same
        </Button>
        <Button variant="ghost" onClick={() => g.send({ type: "SHOW_ME" })}>
          Show me
        </Button>
      </div>
    </div>
  );
}

export function TransferIntro({ g }: { g: GuidedController }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="transfer-intro">
      <Announcer message={`${COPY.transferIntro.title}. ${COPY.transferIntro.body}`} />
      <div className="flex justify-center pt-2">
        <Migo expression="happy" size={140} />
      </div>
      <InfoCard tone="brand" label={COPY.transferIntro.label} title={COPY.transferIntro.title}>
        {COPY.transferIntro.body}
      </InfoCard>
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Button ref={ref} onClick={() => g.send({ type: "START_TRANSFER" })}>
          Start
        </Button>
        <Button variant="ghost" onClick={() => g.send({ type: "SKIP_TRANSFER" })}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

export function Summary({ session, onBack, onAgain }: { session: GuidedSession; onBack: () => void; onAgain: () => void }) {
  const main = session.exercises.find((e) => e.kind === "main");
  const transfer = session.exercises.find((e) => e.kind === "transfer");
  const rows = [
    { label: "Your sentence", ex: main },
    { label: "New situation", ex: transfer },
  ];
  const anyNotCounted = session.exercises.some((e) => e.outcome?.kind === "unverified");
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="flex flex-1 flex-col gap-3.5" data-testid="summary">
      <Announcer message={COPY.summary.title} />
      <div className="flex justify-center pt-2">
        <Migo expression="celebrating" size={120} />
      </div>
      <h1 ref={ref} tabIndex={-1} className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] outline-none">
        {COPY.summary.title}
      </h1>
      <ul className="flex flex-col gap-2.5" aria-label="What you did">
        {rows.map(({ label, ex }) => (
          <li key={label} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
            <span className="text-base font-semibold leading-6">{label}</span>
            {ex?.outcome ? <OutcomeChip kind={ex.outcome.kind} /> : <GrammarTag style="neutral">Skipped</GrammarTag>}
          </li>
        ))}
      </ul>
      {anyNotCounted ? (
        <InfoCard tone="warm" label={COPY.summary.notCountedLabel} testId="not-counted-note">
          {COPY.summary.notCounted}
        </InfoCard>
      ) : (
        <InfoCard tone="neutral" label={COPY.summary.howLabel} testId="how-counted">
          {COPY.summary.how}
        </InfoCard>
      )}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Button onClick={onBack}>Back to lesson</Button>
        <Button variant="secondary" onClick={onAgain}>
          Practice again
        </Button>
      </div>
    </div>
  );
}

