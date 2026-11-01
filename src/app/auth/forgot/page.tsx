import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { NEW_PASSWORD_MESSAGES } from "@/features/accounts/messages";

export const metadata: Metadata = { title: "Forgot password — Grammigo", robots: { index: false, follow: false } };

export default function ForgotPage({ searchParams }: PageProps<"/auth/forgot">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Forgot your password?">
      <p className="text-sm font-medium leading-6 text-ink-2">Enter the email address you joined with. If it has an account that uses a password, we will email a link to choose a new one.</p>
      <Suspense fallback={null}>
        <Problem searchParams={searchParams} />
      </Suspense>
      <form action="/api/auth/password/forgot" method="post" className="flex flex-col gap-4" data-testid="forgot-form">
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Email address
          <input name="email" type="email" required autoComplete="username" maxLength={254} className="min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold" />
        </label>
        <button type="submit" className={primaryButtonClass}>Send the link</button>
      </form>
      <p className="text-sm font-medium text-ink-2">Signed up with Google? There is no password to reset: <Link href="/signin" className="font-bold underline">sign in with Google</Link>.</p>
    </AuthShell>
  );
}

async function Problem({ searchParams }: { searchParams: PageProps<"/auth/forgot">["searchParams"] }) {
  const e = (await searchParams).e;
  const text = e === "email" ? "That doesn’t look like an email address." : typeof e === "string" && Object.hasOwn(NEW_PASSWORD_MESSAGES, e) ? NEW_PASSWORD_MESSAGES[e] : null;
  return text ? <Notice>{text}</Notice> : null;
}
