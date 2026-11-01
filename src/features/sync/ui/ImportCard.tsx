"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { onScopeChange } from "@/lib/scope/storage-scope";
import { useStorageScope } from "@/features/accounts/scope-client";
import { useSyncEngine } from "../hooks";
import { addedToAnotherAccount, alreadyAddedTo, importGuest, readGuest, summarizeGuest, type GuestSummary } from "../guest-import";

const EMPTY = JSON.stringify(summarizeGuest(null));
let memo: { raw: string; out: string } = { raw: "\u0000", out: EMPTY };

/** The guest's progress, summarised. Memoised on the raw saved text, so React's frequent re-reads cost nothing and the value only changes when the data does. */
function guestKey(): string {
  try {
    const raw = `${window.localStorage.getItem("grammigo:v2") ?? ""}\u0000${window.localStorage.getItem("grammigo:guided:v1") ?? ""}`;
    if (raw !== memo.raw) memo = { raw, out: JSON.stringify(summarizeGuest(readGuest())) };
    return memo.out;
  } catch {
    return EMPTY;
  }
}
function subscribeGuest(l: () => void) {
  window.addEventListener("storage", l);
  const off = onScopeChange(l);
  return () => {
    window.removeEventListener("storage", l);
    off();
  };
}

/**
 * Offers to add the progress someone made as a GUEST on this device to the account that is now signed in. It never happens by itself:
 * it needs the learner to press "Add to my account", after being told what it does. Declining ("Not now") changes nothing at all.
 */
export function ImportCard({ userId }: { userId: string }) {
  const scope = useStorageScope();
  const engine = useSyncEngine();
  const key = useSyncExternalStore(subscribeGuest, guestKey, () => EMPTY);
  const summary = useMemo<GuestSummary>(() => JSON.parse(key) as GuestSummary, [key]);
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState<GuestSummary | null>(null);
  const [failed, setFailed] = useState(false);

  if (scope !== userId) return null; // only ever offered into the account that is actually signed in and active

  if (done) {
    return (
      <Card tone="subtle" aria-labelledby="import-done" data-testid="import-done">
        <h2 id="import-done" className="text-xl font-bold leading-7">Added to your account</h2>
        <p className="mt-1 text-sm font-medium leading-5 text-ink-2" role="status">Your guest progress is now part of your account and will be saved there shortly. The guest copy on this device is unchanged.</p>
      </Card>
    );
  }
  if (!summary.hasProgress || dismissed || alreadyAddedTo(userId, summary.fingerprint)) return null;

  const elsewhere = addedToAnotherAccount(userId, summary.fingerprint);
  const parts = [
    summary.lessonsCompleted ? `${summary.lessonsCompleted} ${summary.lessonsCompleted === 1 ? "lesson" : "lessons"} finished` : null,
    summary.lessonsInProgress ? `${summary.lessonsInProgress} in progress` : null,
    summary.quickChecks ? `${summary.quickChecks} quick ${summary.quickChecks === 1 ? "check" : "checks"}` : null,
    summary.guidedSessions ? `${summary.guidedSessions} Guided Correction ${summary.guidedSessions === 1 ? "session" : "sessions"}` : null,
  ].filter(Boolean);

  return (
    <Card tone="brand" aria-labelledby="import-title" data-testid="import-card">
      <h2 id="import-title" className="text-xl font-bold leading-7">Add this device’s progress?</h2>
      <p className="mt-2 text-sm font-medium leading-5" data-testid="import-summary">
        This device has progress from before you signed in, as a guest{parts.length ? `: ${parts.join(", ")}` : ""}. Only add it if it’s yours.
      </p>
      {elsewhere && <p role="alert" className="mt-2 rounded-xl bg-warning-soft p-2 text-sm font-semibold">This same progress was already added to an account on this device. Only add it here if it is yours too.</p>}
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-medium leading-5 text-ink-2">
        <li>It is copied into your account. The guest progress stays on this device, unchanged.</li>
        <li>What your account already has is kept; nothing is replaced.</li>
        <li>Your account saves progress online, so this will be saved there too, including the answers you typed. You can turn that off any time.</li>
      </ul>
      {failed && <p role="alert" className="mt-2 text-sm font-semibold text-error">We couldn’t add it just now. Nothing was changed. Please try again.</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          fullWidth={false}
          onClick={() => {
            try {
              const r = importGuest(userId, Date.now());
              engine?.enable(); // asking to add it is also the learner's agreement to keep their progress in their account
              setDone(r.added);
            } catch {
              setFailed(true);
            }
          }}
        >
          Add to my account
        </Button>
        <Button variant="ghost" fullWidth={false} onClick={() => setDismissed(true)}>Not now</Button>
      </div>
    </Card>
  );
}
