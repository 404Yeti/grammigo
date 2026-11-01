"use client";

import { useEffect, useRef } from "react";
import { codeFromHash } from "./invitation-status";

/**
 * The invitation code input. If the page was opened from an invitation LINK (`/join#c=CODE`) the code is filled in for the person.
 * The code travels in the URL fragment, which browsers never send to a server, so it stays out of access logs and Referer headers; it is
 * removed from the address bar straight away so it is not left in history, a screenshot or a shared URL.
 */
export function InviteCodeField() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const code = codeFromHash(window.location.hash);
    if (!code || !ref.current) return;
    ref.current.value = code;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-bold">
      Invitation code
      <input
        ref={ref}
        name="code"
        required
        maxLength={24}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold tracking-wider"
      />
    </label>
  );
}
