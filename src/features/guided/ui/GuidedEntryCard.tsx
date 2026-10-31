"use client";

import { useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { GUIDED_SKILL_ID } from "@/curriculum/guided";
import { activeGuidedSession } from "../store/actions";
import { getGuidedServerSnapshot, getGuidedSnapshot, subscribeGuided } from "../store/store";
import { guidedVoiceEnabled, guidedVisible } from "../visibility";
import { BETA } from "./copy";

/** The optional doorway into Fix it with Migo, on the lesson introduction and on the lesson review. Nothing else on those screens changes. */
export function GuidedEntryCard({ lessonId, variant }: { lessonId: string; variant: "intro" | "review" }) {
  const state = useSyncExternalStore(subscribeGuided, getGuidedSnapshot, getGuidedServerSnapshot);
  if (lessonId !== GUIDED_SKILL_ID || !guidedVisible()) return null;
  const resuming = !!state && activeGuidedSession(state)?.status === "in_progress";
  const intro = variant === "intro";
  return (
    <section className="rounded-[20px] border border-brand bg-brand-soft p-4" data-testid="guided-entry" aria-labelledby={`guided-entry-${variant}`}>
      <p className="flex items-center gap-2 text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">
        New · optional <GrammarTag style="warning">{BETA.label}</GrammarTag>
      </p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="About this activity">
        <li className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold">{guidedVoiceEnabled() ? "Type or speak" : "Type your answer"}</li>
        {intro && <li className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold">Separate from lesson progress</li>}
      </ul>
      <h2 id={`guided-entry-${variant}`} className="mt-2 text-xl font-bold leading-7">
        {intro ? "Fix it with Migo" : "Try it in your own words"}
      </h2>
      <p className="mt-1 text-base font-medium leading-6 text-ink-2">
        {intro
          ? guidedVoiceEnabled()
            ? "Write or say a sentence. Migo helps you find the mistake and fix it yourself. About 3 minutes."
            : "Write a sentence. Migo helps you find the mistake and fix it yourself. About 3 minutes."
          : guidedVoiceEnabled()
            ? "Fix a sentence with Migo, by typing or speaking."
            : "Fix a sentence with Migo, by typing."}
      </p>
      <p className="mt-1 text-xs font-medium leading-4 text-muted" data-testid="beta-note">
        {BETA.note}
      </p>
      <div className="mt-3">
        <ButtonLink href={`/practice/${lessonId}/guided`} variant="secondary">
          {resuming ? "Continue with Migo" : "Fix it with Migo"}
        </ButtonLink>
      </div>
    </section>
  );
}
