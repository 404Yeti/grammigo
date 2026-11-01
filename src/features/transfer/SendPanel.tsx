"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { readGuest, summarizeGuest, type GuestSummary } from "@/features/sync/guest-import";
import { downloadLocalCopy } from "@/features/sync/local-export";
import { transferOrigins } from "./config";
import { isAck, transferMessageFor } from "./protocol";

/**
 * The OLD address's side, opened by the new address in a window of its own. It READS the guest progress (never writes or deletes it) and, only
 * when the learner presses the button, sends it to the window that opened this one, addressed to EXACTLY the new origin: the browser delivers
 * it only if that window really is on the new origin, so a lookalike page that opened this one receives nothing.
 */
export function SendPanel() {
  const { source, target } = transferOrigins();
  const [here, setHere] = useState<string | null>(null);
  const [summary, setSummary] = useState<GuestSummary | null>(null);
  const [sent, setSent] = useState<"no" | "sent" | "arrived">("no");
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    setHere(window.location.origin);
    setSummary(summarizeGuest(readGuest()));
  }, []);

  useEffect(() => {
    if (sent !== "sent") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== target || event.source !== window.opener) return;
      if (isAck(event.data)) setSent("arrived");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sent, target]);

  if (here === null || summary === null) return null;
  if (here !== source) {
    return <p role="status" className="rounded-2xl bg-subtle p-4 text-sm font-medium leading-6" data-testid="transfer-wrong-place">This page is for the old Grammigo address. Start from {target.replace(/^https?:\/\//, "")} to bring your progress across.</p>;
  }
  const hasOpener = typeof window.opener === "object" && window.opener !== null;
  const parts = [
    summary.lessonsCompleted ? `${summary.lessonsCompleted} ${summary.lessonsCompleted === 1 ? "lesson" : "lessons"} finished` : null,
    summary.lessonsInProgress ? `${summary.lessonsInProgress} in progress` : null,
    summary.quickChecks ? `${summary.quickChecks} quick ${summary.quickChecks === 1 ? "check" : "checks"}` : null,
    summary.guidedSessions ? `${summary.guidedSessions} Guided Correction ${summary.guidedSessions === 1 ? "session" : "sessions"}` : null,
  ].filter(Boolean);

  const send = () => {
    const guest = readGuest();
    if (!guest || !window.opener) return;
    window.opener.postMessage(transferMessageFor(guest.lessons, guest.guided), target); // exact target origin: never "*"
    setSent("sent");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="transfer-send" data-sent={sent}>
      {summary.hasProgress ? (
        <p className="text-sm font-medium leading-6" data-testid="transfer-send-summary">This device has your guest progress: {parts.join(", ")}. It stays here, unchanged, whatever you do.</p>
      ) : (
        <p className="text-sm font-medium leading-6" data-testid="transfer-send-summary">There is no guest progress on this device to send.</p>
      )}
      {sent === "no" && (
        <Button onClick={send} disabled={!summary.hasProgress || !hasOpener} data-testid="transfer-send-button">Send my progress to {target.replace(/^https?:\/\//, "")}</Button>
      )}
      {sent === "no" && !hasOpener && <p className="text-xs font-medium text-muted" data-testid="transfer-no-opener">Open this from {target.replace(/^https?:\/\//, "")} (“Bring my progress”) to send it directly, or download a copy below.</p>}
      {sent === "sent" && <p role="status" className="text-sm font-semibold" data-testid="transfer-sent">Sent. Check the other window and choose whether to add it.</p>}
      {sent === "arrived" && <p role="status" className="rounded-2xl bg-success-soft p-4 text-sm font-semibold" data-testid="transfer-arrived">It arrived and was added. You can close this window. Your progress here is unchanged.</p>}
      <div className="rounded-2xl border border-line p-4">
        <p className="text-sm font-bold">Prefer a file?</p>
        <Button variant="secondary" className="mt-2" fullWidth={false} onClick={() => setDownloaded(downloadLocalCopy())} disabled={!summary.hasProgress} data-testid="transfer-download">
          <Download size={16} aria-hidden /> Download a copy of my progress
        </Button>
        {downloaded && <p role="status" className="mt-2 text-xs font-medium text-muted">Downloaded. On the new address choose “Or use a file”.</p>}
      </div>
    </div>
  );
}
