"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useStorageScope } from "@/features/accounts/scope-client";
import { applyTransfer, describePreview, previewTransfer, type TransferPreview } from "./apply";
import { transferOrigins } from "./config";
import { ackMessage_, parseDeviceCopyText, parseIncoming, REJECTION_TEXT, type Incoming, type Rejected } from "./protocol";

type Phase = "idle" | "waiting" | "preview" | "done";

/**
 * The NEW address's side. Nothing happens until the learner presses "Bring my progress": that opens the old address in a window of its own, and
 * only a message from EXACTLY that origin, sent by THAT window, is considered, once, while waiting. What arrives is validated, then shown as a
 * preview. Nothing is written until the learner presses "Add to this device". A file works the same way.
 */
export function ReceivePanel() {
  const { source, target } = transferOrigins();
  const scope = useStorageScope();
  const [phase, setPhase] = useState<Phase>("idle");
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => setHere(window.location.origin), []);

  // While waiting for the other window, listen. The listener exists only in that state and is removed as soon as one acceptable answer arrives.
  useEffect(() => {
    if (phase !== "waiting") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== source) return; // not the old address
      if (!popup.current || event.source !== popup.current) return; // not the window we opened
      const parsed = parseIncoming(event.data);
      if (!parsed.ok) return void setProblem(REJECTION_TEXT[parsed.reason]);
      setIncoming(parsed.value);
      setPreview(previewTransfer(parsed.value));
      setProblem(null);
      setPhase("preview");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase, source]);

  if (here !== null && here !== target) {
    return <p role="status" className="rounded-2xl bg-subtle p-4 text-sm font-medium leading-6" data-testid="transfer-wrong-place">This page is for the new Grammigo address. Open {target.replace(/^https?:\/\//, "")} to bring your progress here.</p>;
  }
  if (scope !== "") {
    return (
      <p role="status" className="rounded-2xl bg-warning-soft p-4 text-sm font-semibold leading-6" data-testid="transfer-signed-in">
        You are signed in. Progress from the old address is added to the guest copy on this device, so sign out first. After that you can add it to your account from your dashboard, as with any guest progress.
      </p>
    );
  }

  const reject = (r: Rejected) => setProblem(REJECTION_TEXT[r.reason]);
  const begin = () => {
    setProblem(null);
    popup.current = window.open(`${source}/transfer/send`, "grammigo-transfer", "popup,width=480,height=680");
    if (!popup.current) return void setProblem("Your browser blocked the window. Allow pop-ups for this page and try again, or use a file instead.");
    setPhase("waiting");
  };
  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3_000_000) return reject({ ok: false, reason: "too_large" });
    const parsed = parseDeviceCopyText(await file.text());
    if (!parsed.ok) return reject(parsed);
    setIncoming(parsed.value);
    setPreview(previewTransfer(parsed.value));
    setProblem(null);
    setPhase("preview");
  };
  const confirm = () => {
    if (!incoming) return;
    try {
      applyTransfer(incoming);
    } catch {
      return void setProblem("We couldn’t add it. Nothing was changed. Please try again.");
    }
    popup.current?.postMessage(ackMessage_(), source); // tells the old window it arrived; it never deletes anything
    setIncoming(null);
    setPhase("done");
  };
  const cancel = () => {
    setIncoming(null);
    setPreview(null);
    setPhase("idle");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="transfer-receive" data-phase={phase}>
      {phase === "idle" && (
        <>
          <p className="text-sm font-medium leading-6 text-ink-2">
            If you practised as a guest at {source.replace(/^https?:\/\//, "")}, you can bring that progress here. You choose, you see what will be added first, and nothing is deleted from the old address.
          </p>
          <Button onClick={begin} data-testid="transfer-begin">Bring my progress from {source.replace(/^https?:\/\//, "")}</Button>
          <div className="rounded-2xl border border-line p-4">
            <p className="text-sm font-bold">Or use a file</p>
            <p className="mt-1 text-xs font-medium text-muted">On the old address, download “a copy of my progress”, then choose that file here.</p>
            <input type="file" accept="application/json,.json" onChange={(e) => void fromFile(e.target.files?.[0])} className="mt-2 block min-h-11 w-full text-sm" aria-label="Choose a progress file" data-testid="transfer-file" />
          </div>
        </>
      )}
      {phase === "waiting" && (
        <p role="status" className="rounded-2xl bg-subtle p-4 text-sm font-medium leading-6" data-testid="transfer-waiting">
          A window from {source.replace(/^https?:\/\//, "")} opened. Press “Send my progress” there. Nothing is added yet.
        </p>
      )}
      {phase === "preview" && preview && (
        <div className="rounded-2xl border border-line-strong bg-surface p-4" data-testid="transfer-preview">
          <h2 className="text-lg font-bold">Add this progress?</h2>
          <p className="mt-2 text-sm font-medium leading-6" data-testid="transfer-preview-text">{describePreview(preview)}</p>
          <p className="mt-1 text-xs font-medium text-muted">It is added to the guest copy on this device. What is already here is kept. The old address keeps its copy too.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button fullWidth={false} onClick={confirm} data-testid="transfer-confirm">Add to this device</Button>
            <Button variant="ghost" fullWidth={false} onClick={cancel} data-testid="transfer-cancel">Not now</Button>
          </div>
        </div>
      )}
      {phase === "done" && (
        <p role="status" className="rounded-2xl bg-success-soft p-4 text-sm font-semibold leading-6" data-testid="transfer-done">
          Added to this device. You can close the other window. The old address still has its own copy.
        </p>
      )}
      {problem && <p role="alert" className="rounded-2xl bg-error-soft p-3 text-sm font-semibold text-error" data-testid="transfer-problem">{problem}</p>}
    </div>
  );
}
