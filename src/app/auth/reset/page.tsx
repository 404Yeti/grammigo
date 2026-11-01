import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { RECOVERY_TOKEN } from "@/lib/auth/password";

export const metadata: Metadata = { title: "Reset your password — Grammigo", robots: { index: false, follow: false }, referrer: "no-referrer" };

// The link in the password-reset email lands here. Opening this page changes NOTHING (a mail scanner or link preview that fetches it cannot use
// the one-time token up); the button posts the token to the server. It works in any browser or on any device.
export default function ResetPage({ searchParams }: PageProps<"/auth/reset">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/auth/reset">["searchParams"] }) {
  const t = (await searchParams).token_hash;
  const token = typeof t === "string" && RECOVERY_TOKEN.test(t) ? t : null;
  return (
    <AuthShell title="Reset your password">
      {token ? (
        <form action="/api/auth/recover" method="post" className="flex flex-col gap-4" data-testid="reset-form">
          <p className="text-sm font-medium leading-6 text-ink-2">Press the button to choose a new password for your Grammigo account. This link works once.</p>
          <input type="hidden" name="token_hash" value={token} />
          <button type="submit" className={primaryButtonClass}>Choose a new password</button>
        </form>
      ) : (
        <p role="alert" className="rounded-[14px] border-[1.5px] border-line-strong bg-subtle px-4 py-3 text-sm font-semibold leading-6 text-ink">
          This reset link isn’t complete. Open the newest email from Grammigo and use the link in it, or ask for a new one.
        </p>
      )}
    </AuthShell>
  );
}
