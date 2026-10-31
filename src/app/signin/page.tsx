import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { SIGNIN_MESSAGES } from "@/features/accounts/messages";

export const metadata: Metadata = { title: "Sign in — Grammigo", robots: { index: false, follow: false } };

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Sign in">
      <Suspense fallback={null}>
        <SignInNotice searchParams={searchParams} />
      </Suspense>
      <form action="/api/auth/signin" method="post" className="flex flex-col gap-4">
        <button type="submit" className={primaryButtonClass}>Continue with Google</button>
      </form>
      <p className="text-sm font-medium leading-6 text-ink-2">
        New here? Accounts are by invitation. <Link href="/join" className="font-bold underline">Join with an invitation code</Link>, or{" "}
        <Link href="/" className="font-bold underline">keep practising without an account</Link>.
      </p>
    </AuthShell>
  );
}

async function SignInNotice({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const e = (await searchParams).e;
  const message = typeof e === "string" && Object.hasOwn(SIGNIN_MESSAGES, e) ? SIGNIN_MESSAGES[e] : null;
  return message ? <Notice>{message}</Notice> : null;
}
