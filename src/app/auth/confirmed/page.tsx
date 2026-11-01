import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AuthShell, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";

export const metadata: Metadata = { title: "Email confirmed — Grammigo", robots: { index: false, follow: false } };

// The confirmation link lands here. It signs nobody in and creates nothing: it only tells the person to sign in with their password.
export default function ConfirmedPage() {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Email confirmed">
      <p role="status" className="text-sm font-medium leading-6 text-ink-2" data-testid="email-confirmed">
        Thank you. Your email address is confirmed. Now sign in with your email and password to finish joining.
      </p>
      <Link href="/signin" className={primaryButtonClass}>Sign in</Link>
    </AuthShell>
  );
}
