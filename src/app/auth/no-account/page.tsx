import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell, primaryButtonClass, secondaryLinkClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";

export const metadata: Metadata = { title: "No account — Grammigo", robots: { index: false, follow: false } };

export default function NoAccountPage() {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="No account yet">
      <p className="text-sm font-medium leading-6 text-ink-2">
        That Google account isn’t set up for Grammigo. Accounts are by invitation, and nothing was created or kept.
      </p>
      <Link href="/join" className={primaryButtonClass}>I have an invitation code</Link>
      <Link href="/" className={secondaryLinkClass}>Keep practising without an account</Link>
      <form action="/api/auth/signout" method="post">
        <button type="submit" className={secondaryLinkClass}>Sign out</button>
      </form>
    </AuthShell>
  );
}
