"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DELETE_CONFIRM_PHRASE } from "@/lib/auth/constants";
import { removeAccountFromDevice } from "./local-cleanup";

/**
 * Permanently deleting the signed-in account. It asks for the confirmation words and an explicit acknowledgement, then sends ONE request;
 * the server decides everything that matters (that the person is signed in, signed in recently, and who they are). Nothing here names
 * which account to delete. The confirmation is never put in the address bar or in any storage, and never logged.
 */
/** `accountId` comes from the verified session on the server (not from the browser's folder cookie), so the right folder is removed whatever the cookie says. */
export function DeleteAccountForm({ accountId }: { accountId: string }) {
  const [phrase, setPhrase] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [removeLocal, setRemoveLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"reauth" | "failed" | "rate" | "offline" | "confirmation" | "owner" | null>(null);

  const ready = phrase.trim().toLowerCase().replace(/\s+/g, " ") === DELETE_CONFIRM_PHRASE && understood && !busy;

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: phrase }) });
      if (res.ok) {
        if (removeLocal) removeAccountFromDevice(accountId);
        window.location.replace("/auth/deleted"); // a full load: nothing of the account stays in the page or the router cache, and Back does not return here
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setProblem(body.error === "reauth_required" ? "reauth" : res.status === 429 ? "rate" : body.error === "confirmation" ? "confirmation" : body.error === "owner_account" ? "owner" : "failed");
    } catch {
      setProblem("offline");
    } finally {
      setBusy(false);
    }
  }

  const messages = {
    reauth: "Your last sign-in was more than 10 minutes ago. Please sign in with Google again, then try once more.",
    rate: "Too many tries. Please wait a few minutes.",
    confirmation: "The words didn’t match. Nothing was deleted.",
    owner: "This is the owner account, which can’t be deleted here. Nothing was deleted.",
    offline: "We couldn’t reach Grammigo. Nothing was deleted. Check your connection and try again.",
    failed: "Something went wrong and your account was NOT deleted. Please try again in a moment.",
  } as const;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
      data-testid="delete-form"
    >
      <label className="flex flex-col gap-1.5 text-sm font-bold">
        Type “{DELETE_CONFIRM_PHRASE}” to confirm
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={60}
          data-testid="delete-phrase"
          className="min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold"
        />
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm font-medium leading-5">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-5 accent-[var(--color-error)]" data-testid="delete-understood" />
        I understand this permanently deletes my account and everything saved in it, and can’t be undone.
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm font-medium leading-5">
        <input type="checkbox" checked={removeLocal} onChange={(e) => setRemoveLocal(e.target.checked)} className="mt-0.5 size-5 accent-[var(--color-brand)]" data-testid="delete-local" />
        Also remove this account’s saved progress from this device. (Practice you did without signing in is never touched.)
      </label>
      {problem && (
        <div role="alert" className="rounded-2xl bg-error-soft p-3 text-sm font-semibold text-error" data-testid="delete-error">
          <p>{messages[problem]}</p>
          {problem === "reauth" && (
            <p className="mt-2">
              <button type="submit" formAction="/api/auth/reauth" formNoValidate className="min-h-11 font-bold underline underline-offset-4" data-testid="delete-reauth">Sign in with Google again</button>
            </p>
          )}
        </div>
      )}
      <Button type="submit" disabled={!ready} className="!bg-error !text-on-inverse disabled:!bg-subtle disabled:!text-muted" data-testid="delete-submit">
        <Trash2 size={18} aria-hidden /> {busy ? "Deleting…" : "Delete my account permanently"}
      </Button>
    </form>
  );
}
