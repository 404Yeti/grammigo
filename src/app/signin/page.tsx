import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass, secondaryButtonClass, secondaryLinkClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { SIGNIN_MESSAGES } from "@/features/accounts/messages";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Sign in — Grammigo", robots: { index: false, follow: false } };

const field = "min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold";

/**
 * One place to come back to. Returning students choose Google or their email and password; there is no invitation step here. Invitations are only for
 * joining, so newcomers get a clear way to that page below.
 */
export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Welcome back" intro="Pick up where you left off." mascot="happy">
      <Suspense fallback={null}>
        <SignInNotice searchParams={searchParams} />
      </Suspense>
      <Card className="flex flex-col gap-4">
        <form action="/api/auth/signin" method="post">
          <button type="submit" className={secondaryButtonClass}>Continue with Google</button>
        </form>
        <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.6px] text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          or use your email
          <span className="h-px flex-1 bg-line" />
        </div>
        <form action="/api/auth/password/signin" method="post" className="flex flex-col gap-3" data-testid="password-signin">
          <label className="flex flex-col gap-1.5 text-sm font-bold">
            Email address
            <input name="email" type="email" required autoComplete="username" maxLength={254} className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold">
            Password
            <input name="password" type="password" required autoComplete="current-password" maxLength={200} className={field} />
          </label>
          <Link href="/auth/forgot" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-brand-text underline underline-offset-4">Forgot your password?</Link>
          <button type="submit" className={primaryButtonClass}>Sign in with email</button>
        </form>
      </Card>
      <Card tone="subtle" className="flex flex-col gap-3">
        <h2 className="text-lg font-bold leading-7">New to Grammigo?</h2>
        <p className="text-sm font-medium leading-6 text-ink-2">Accounts are by invitation. If you have an invitation code from your teacher, join here; you only do this once.</p>
        <Link href="/join" className={secondaryLinkClass}>Join with an invitation code</Link>
        <p className="text-center text-sm font-medium text-ink-2">
          Prefer a password to Google? <Link href="/join/email" className="font-bold underline underline-offset-4">Join with email</Link>
        </p>
      </Card>
      <p className="text-center text-sm font-medium text-ink-2">
        You don’t need an account to practise. <Link href="/learn" className="font-bold underline underline-offset-4">Keep practising without an account</Link>
      </p>
    </AuthShell>
  );
}

async function SignInNotice({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const e = (await searchParams).e;
  const message = typeof e === "string" && Object.hasOwn(SIGNIN_MESSAGES, e) ? SIGNIN_MESSAGES[e] : null;
  return message ? <Notice>{message}</Notice> : null;
}
