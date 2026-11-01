"use client";

import { useEffect, useState } from "react";
import { primaryButtonClass } from "@/features/accounts/AuthShell";
import { RECOVERY_TOKEN } from "@/lib/auth/recovery-token";

/**
 * The reset email's link is /auth/reset#token_hash=… . A URL fragment is never sent to a server, so the token reaches neither Vercel's request logs nor
 * the CDN. This reads it, removes it from the address bar and the history entry at once, and puts it in a form that POSTs it in the request BODY.
 * A mail scanner or link preview that fetches the page does not run this script, so it cannot use the one-time token up.
 */
export function ResetForm() {
  const [state, setState] = useState<{ token: string | null } | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token_hash");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    setState({ token: t && RECOVERY_TOKEN.test(t) ? t : null });
  }, []);
  if (!state) return <p className="text-sm font-medium leading-6 text-ink-2">One moment…</p>;
  if (!state.token) {
    return (
      <p role="alert" className="rounded-[14px] border-[1.5px] border-line-strong bg-subtle px-4 py-3 text-sm font-semibold leading-6 text-ink">
        This reset link isn’t complete (or it needs JavaScript, which must be on). Open the newest email from Grammigo and use the link in it, or ask for a new one.
      </p>
    );
  }
  return (
    <form action="/api/auth/recover" method="post" className="flex flex-col gap-4" data-testid="reset-form">
      <p className="text-sm font-medium leading-6 text-ink-2">Press the button to choose a new password for your Grammigo account. This link works once.</p>
      <input type="hidden" name="token_hash" value={state.token} />
      <button type="submit" className={primaryButtonClass}>Choose a new password</button>
    </form>
  );
}
