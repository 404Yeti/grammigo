"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Downloads everything the account holds about the signed-in learner. It asks the server with a same-origin POST (it records that an export
 * happened, so it needs the same cross-site protection as every state-changing request) and hands the answer to the browser as a file.
 * Nothing is kept in the page afterwards. (A plain form post would also work, but some browsers do not treat its answer as a download.)
 */
const MESSAGES: Record<string, string> = {
  rate: "You have downloaded a few times already. Please try again in a while.",
  unavailable: "We couldn’t reach your account just now. Please try again in a moment.",
  signin: "Your sign-in has ended. Please sign in again.",
  failed: "We couldn’t make the file. Please try again.",
};

export function ExportButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | keyof typeof MESSAGES>("idle");

  async function download() {
    setState("busy");
    try {
      const res = await fetch("/api/account/export", { method: "POST" });
      if (!res.ok) {
        setState(res.status === 429 ? "rate" : res.status === 503 ? "unavailable" : res.status === 401 ? "signin" : "failed");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "grammigo-my-data.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("done");
    } catch {
      setState("unavailable");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={() => void download()} disabled={state === "busy"} data-testid="export-button">
        <Download size={18} aria-hidden /> {state === "busy" ? "Preparing…" : "Download my data"}
      </Button>
      {state === "done" && <p role="status" className="text-sm font-medium text-ink-2">Your file was downloaded to this device.</p>}
      {state in MESSAGES && <p role="alert" className="text-sm font-semibold text-error">{MESSAGES[state]}</p>}
    </div>
  );
}
