import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";

export const metadata: Metadata = { title: "Account deleted — Grammigo", robots: { index: false, follow: false } };

export default function DeletedPage() {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Your account is deleted">
      <p role="status" className="text-sm font-medium leading-6 text-ink-2">
        Your account and everything saved in it have been deleted, and you are signed out. You can still practise Grammigo as a guest on this device any time.
      </p>
      <Link href="/" className={primaryButtonClass}>Keep practising</Link>
    </AuthShell>
  );
}
