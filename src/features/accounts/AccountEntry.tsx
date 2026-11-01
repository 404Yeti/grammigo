"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { accountsEnabled } from "./enabled";
import { useStorageScope } from "./scope-client";

/**
 * The one door from the anonymous app to accounts: "Sign in" for a guest, "Account" for someone signed in on this device. It is a plain
 * link. Signing in is never required to use Grammigo, and with accounts off (the default) this renders nothing at all.
 * (It judges "signed in" from this browser's progress scope; the server decides whether the session is real when the link is followed.)
 */
export function AccountEntry() {
  const scope = useStorageScope();
  if (!accountsEnabled()) return null;
  const signedIn = scope !== "";
  return (
    <nav aria-label="Account" className="absolute right-4 top-3 z-20 lg:right-14 lg:top-5" data-testid="account-entry">
      <Link
        href={signedIn ? "/account" : "/signin"}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-bold text-ink hover:bg-subtle"
      >
        {signedIn ? (
          <>
            <UserRound size={16} aria-hidden /> Account
          </>
        ) : (
          "Sign in"
        )}
      </Link>
    </nav>
  );
}
