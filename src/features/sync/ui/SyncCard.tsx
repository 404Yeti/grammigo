"use client";

import { Cloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { timeAgo } from "@/lib/utils/time";
import { useSyncEngine, useSyncStatus } from "../hooks";
import { describeStatus } from "../status-text";

/**
 * Saving to the account: whether it is on, what it is doing, and the one place to turn it on or off. Turning it ON is the learner's explicit
 * consent, so the card says exactly what is saved before asking. Nothing is uploaded before they press the button.
 */
export function SyncCard() {
  const engine = useSyncEngine();
  const status = useSyncStatus();
  if (!engine || !status) return null;
  const view = describeStatus(status, (t) => timeAgo(t));
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

  const m = engine.getMetrics();
  return (
    <Card aria-labelledby="sync-title" data-testid="sync-card" data-phase={status.phase}>
      <h2 id="sync-title" className="flex items-center gap-2 text-xl font-bold leading-7"><Cloud size={20} aria-hidden /> Saving to my account</h2>
      <p className="mt-2 text-sm font-semibold" data-testid="sync-label">{view.label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-ink-2" data-testid="sync-detail" role="status">{view.detail}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" fullWidth={false} onClick={() => engine.syncNow()} disabled={status.phase === "syncing"}>Save now</Button>
        <Button variant="ghost" fullWidth={false} onClick={() => engine.pause()}>Turn off on this device</Button>
      </div>
      {m.calls > 0 && (
        <details className="mt-3 text-xs font-medium text-muted">
          <summary className="min-h-11 cursor-pointer py-2.5">Connection details</summary>
          <p data-testid="sync-metrics">
            {m.calls} {m.calls === 1 ? "request" : "requests"} this visit; typical {m.p50} ms, slowest {m.max} ms. Saving happens in the background and never holds up a lesson.
          </p>
        </details>
      )}
    </Card>
  );
}
