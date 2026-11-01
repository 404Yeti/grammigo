import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { InviteCodeField } from "@/features/accounts/InviteCodeField";
import { REGISTER_MESSAGES } from "@/features/accounts/messages";
import { PASSWORD_MIN } from "@/lib/auth/password-policy";

export const metadata: Metadata = { title: "Join with email — Grammigo", robots: { index: false, follow: false } };

const field = "min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold";

export default function JoinWithEmailPage({ searchParams }: PageProps<"/join/email">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Join with email">
      <p className="text-sm font-medium leading-6 text-ink-2">
        Accounts are by invitation. Enter your invitation code, your email address and a password. We email you a link to confirm the address; after that you can sign in.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm font-medium leading-6 text-ink-2" data-testid="join-disclosures">
        <li>Your password is kept by our sign-in provider, never by Grammigo, and never shown to anyone.</li>
        <li>We keep your profile. Your lesson progress is kept online only if you choose to turn that on.</li>
        <li>You can download your data or delete your account at any time from your profile.</li>
        <li>This is an early pilot for adults. The <Link href="/privacy" className="font-bold underline">privacy notice</Link> is a draft that has not yet been reviewed by a lawyer.</li>
      </ul>
      <Suspense fallback={null}>
        <RegisterError searchParams={searchParams} />
      </Suspense>
      <form action="/api/auth/email/register" method="post" className="flex flex-col gap-4" data-testid="register-form">
        <InviteCodeField />
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Email address
          <input name="email" type="email" required autoComplete="username" maxLength={254} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Choose a password (at least {PASSWORD_MIN} characters)
          <input name="password" type="password" required minLength={PASSWORD_MIN} maxLength={72} autoComplete="new-password" className={field} />
        </label>
        <label className="flex items-start gap-3 text-sm font-medium leading-6">
          <input name="adult" type="checkbox" required className="mt-1 size-5" />
          <span>I’m 18 or older, and I’ve read the <Link href="/privacy" className="font-bold underline">privacy notice</Link>.</span>
        </label>
        <button type="submit" className={primaryButtonClass}>Create my account</button>
      </form>
      <p className="text-sm font-medium text-ink-2">
        Prefer Google? <Link href="/join" className="font-bold underline">Join with Google</Link>. Already have an account? <Link href="/signin" className="font-bold underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

async function RegisterError({ searchParams }: { searchParams: PageProps<"/join/email">["searchParams"] }) {
  const e = (await searchParams).e;
  return typeof e === "string" && Object.hasOwn(REGISTER_MESSAGES, e) ? <Notice>{REGISTER_MESSAGES[e]}</Notice> : null;
}
