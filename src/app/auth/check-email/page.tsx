import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, secondaryLinkClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";

export const metadata: Metadata = { title: "Check your email — Grammigo", robots: { index: false, follow: false } };

export default function CheckEmailPage({ searchParams }: PageProps<"/auth/check-email">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Check your email">
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
      <Link href="/signin" className={secondaryLinkClass}>Back to sign in</Link>
    </AuthShell>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/auth/check-email">["searchParams"] }) {
  const k = (await searchParams).k;
  return k === "reset" ? (
    <p role="status" className="text-sm font-medium leading-6 text-ink-2" data-testid="check-email-reset">
      If that address has a Grammigo account that uses a password, we have sent it a link to choose a new one. Open the link <b>in this same browser</b>, within the hour. If nothing arrives in a few minutes, check your spam folder.
    </p>
  ) : (
    <p role="status" className="text-sm font-medium leading-6 text-ink-2" data-testid="check-email-confirm">
      We have sent a link to confirm your email address. Open it, then sign in with your email and password. The seat held for you stays reserved for 24 hours. If nothing arrives in a few minutes, check your spam folder.
    </p>
  );
}
