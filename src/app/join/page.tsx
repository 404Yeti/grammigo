import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { InviteCodeField } from "@/features/accounts/InviteCodeField";
import { JOIN_MESSAGES } from "@/features/accounts/messages";
import { JOIN_ERRORS, type JoinError } from "@/lib/auth/constants";

export const metadata: Metadata = { title: "Join — Grammigo", robots: { index: false, follow: false } };

export default function JoinPage({ searchParams }: PageProps<"/join">) {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Join Grammigo">
      <p className="text-sm font-medium leading-6 text-ink-2">
        Accounts are by invitation for now. You don’t need one to practise: lessons and your progress work on this device without signing in.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm font-medium leading-6 text-ink-2" data-testid="join-disclosures">
        <li>You sign in with Google. Grammigo receives your email address and name, never your password.</li>
        <li>We keep your profile. Your lesson progress is kept online only if you choose to turn that on, and you can turn it off.</li>
        <li>You can download your data or delete your account at any time from your profile.</li>
        <li>This is an early pilot for adults. The <Link href="/privacy" className="font-bold underline">privacy notice</Link> is a draft that has not yet been reviewed by a lawyer.</li>
      </ul>
      <Suspense fallback={null}>
        <JoinError searchParams={searchParams} />
      </Suspense>
      <form action="/api/auth/join" method="post" className="flex flex-col gap-4">
        <InviteCodeField />
        <label className="flex items-start gap-3 text-sm font-medium leading-6">
          <input name="adult" type="checkbox" required className="mt-1 size-5" />
          <span>I’m 18 or older, and I’ve read the <Link href="/privacy" className="font-bold underline">privacy notice</Link>.</span>
        </label>
        <button type="submit" className={primaryButtonClass}>Continue with Google</button>
      </form>
      <p className="text-sm font-medium text-ink-2">
        No Google account, or you prefer a password? <Link href="/join/email" className="font-bold underline">Join with email and a password</Link>.
      </p>
      <p className="text-sm font-medium text-ink-2">
        Already have an account? <Link href="/signin" className="font-bold underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

async function JoinError({ searchParams }: { searchParams: PageProps<"/join">["searchParams"] }) {
  const e = (await searchParams).e;
  const code = typeof e === "string" && (JOIN_ERRORS as readonly string[]).includes(e) ? (e as JoinError) : null;
  return code ? <Notice>{JOIN_MESSAGES[code]}</Notice> : null;
}
