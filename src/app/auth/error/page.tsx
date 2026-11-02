import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass, secondaryLinkClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { ERROR_MESSAGES } from "@/features/accounts/messages";

export const metadata: Metadata = { title: "Sign-in problem — Grammigo", robots: { index: false, follow: false } };

export default function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Sign-in problem">
      <Suspense fallback={null}>
        <Reason searchParams={searchParams} />
      </Suspense>
      <Link href="/signin" className={primaryButtonClass}>Back to sign in</Link>
      <Link href="/learn" className={secondaryLinkClass}>Keep practising</Link>
    </AuthShell>
  );
}

async function Reason({ searchParams }: { searchParams: PageProps<"/auth/error">["searchParams"] }) {
  const r = (await searchParams).r;
  const message = typeof r === "string" && Object.hasOwn(ERROR_MESSAGES, r) ? ERROR_MESSAGES[r] : ERROR_MESSAGES.server;
  return <Notice>{message}</Notice>;
}
