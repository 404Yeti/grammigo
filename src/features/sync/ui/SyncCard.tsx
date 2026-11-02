"use client";

import Link from "next/link";
import { useState } from "react";
import { Cloud, CloudCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { timeAgo } from "@/lib/utils/time";
import type { SyncEngine, SyncStatus } from "../engine";
import { useSyncEngine, useSyncStatus } from "../hooks";
import { downloadLocalCopy } from "../local-export";
import { describeStatus } from "../status-text";

/**
 * Saving to the account, as the learner sees it. Turning it ON is the learner's explicit consent, so the card says exactly what is saved before
 * asking; nothing is uploaded before they press the button. Once it is on, the card is a calm "your progress is saved" message: no technical
 * numbers, and the manual controls are tucked away unless something actually needs the learner (unsaved work, a failed save, no connection).
 */
export function SyncCard() {
  const engine = useSyncEngine();
  const status = useSyncStatus();
  if (!engine || !status) return null;
  return <SyncCardView engine={engine} status={status} />;
}

type Controls = Pick<SyncEngine, "enable" | "pause" | "syncNow">;

export function SyncCardView({ engine, status }: { engine: Controls; status: SyncStatus }) {
  const [downloaded, setDownloaded] = useState<"idle" | "done" | "failed">("idle");
  const needsConsent = status.phase === "needs_consent" || status.phase === "off" || status.paused;

  if (needsConsent) {
    return (
      <Card aria-labelledby="sync-title" data-testid="sync-card" data-phase={status.phase}>
        <h2 id="sync-title" className="flex items-center gap-2 text-xl font-bold leading-7"><Cloud size={20} aria-hidden /> Keep my progress in my account</h2>
        <p className="mt-2 text-sm font-medium leading-5 text-ink-2">
          {status.paused ? "Saving to your account is off on this device." : "Right now your progress is only on this device."} If you turn saving on, Grammigo keeps your lesson
          answers, quick-check answers, goals and Guided Correction attempts (the text you typed or confirmed, never audio) in your account, so you can pick up on another
          device. You can turn it off any time. Your progress on this device stays here either way.
        </p>
        <Button className="mt-3" onClick={() => engine.enable()}>Turn on saving to my account</Button>
      </Card>
    );
  }

  const allSaved = status.phase === "idle" && !status.unsaved && status.lastSyncedAt !== null;
  const base = describeStatus(status, (t) => timeAgo(t));
  // Calm and friendly when all is well; every problem keeps its full, honest explanation.
  const view = allSaved ? { label: "All saved", detail: "Your progress is safe in your account." } : base;
  const tone = allSaved ? "success" : base.tone;
  // "Save now" is only worth showing when there is something to save or a save has failed. Otherwise it lives under "Saving options".
  // (Not while signed out, blocked or too large: a save cannot succeed until the learner does something else.)
  const canSaveNow = status.phase === "idle" || status.phase === "retrying" || status.phase === "offline";
  const needsSaveNow = canSaveNow && !allSaved && (status.unsaved || status.phase === "retrying" || status.phase === "offline");

  return (
    <Card aria-labelledby="sync-title" data-testid="sync-card" data-phase={status.phase}>
      <h2 id="sync-title" className="flex items-center gap-2 text-xl font-bold leading-7">
        {allSaved ? <CloudCheck size={20} className="text-success" aria-hidden /> : <Cloud size={20} aria-hidden />} Your progress
      </h2>
      <p className={tone === "success" ? "mt-2 text-base font-bold text-success" : "mt-2 text-base font-bold"} data-testid="sync-label">{view.label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-ink-2" data-testid="sync-detail" role="status">{view.detail}</p>
      {status.phase === "too_large" && (
        <div role="alert" className="mt-3 rounded-xl bg-warning-soft p-3" data-testid="too-large-warning">
          <p className="text-sm font-semibold">Your progress is not being saved to your account.</p>
          <p className="mt-1 text-sm font-medium leading-5">It has grown too large for your account to hold. Nothing has been deleted or changed: it is all safe on this device. Download a copy to keep it, and keep using this device.</p>
          <Button className="mt-2" variant="secondary" fullWidth={false} onClick={() => setDownloaded(downloadLocalCopy() ? "done" : "failed")} data-testid="download-copy">
            <Download size={16} aria-hidden /> Download a copy of my progress
          </Button>
          {downloaded === "done" && <p className="mt-2 text-sm font-medium" role="status">A copy was downloaded to this device.</p>}
          {downloaded === "failed" && <p className="mt-2 text-sm font-semibold text-error" role="alert">Your browser would not save the file. Your progress is still on this device.</p>}
        </div>
      )}
      {status.phase === "needs_signin" && (
        <Link href="/signin" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-brand-text underline underline-offset-4">Sign in again</Link>
      )}
      {needsSaveNow && (
        <Button className="mt-3" variant="secondary" fullWidth={false} onClick={() => engine.syncNow()}>Save now</Button>
      )}
      <details className="mt-3 text-sm font-medium text-ink-2" data-testid="sync-options">
        <summary className="min-h-11 cursor-pointer py-2.5 text-xs font-bold text-muted">Saving options</summary>
        <div className="flex flex-wrap gap-3 pb-1">
          {!needsSaveNow && (
            <Button variant="ghost" fullWidth={false} onClick={() => engine.syncNow()} disabled={status.phase === "syncing"}>Save now</Button>
          )}
          <Button variant="ghost" fullWidth={false} onClick={() => engine.pause()}>Turn off on this device</Button>
        </div>
      </details>
    </Card>
  );
}
