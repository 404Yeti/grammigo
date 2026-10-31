import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
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
      <Suspense fallback={null}>
        <JoinError searchParams={searchParams} />
      </Suspense>
      <form action="/api/auth/join" method="post" className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Invitation code
          <input
            name="code"
            required
            maxLength={24}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold tracking-wider"
          />
        </label>
        <label className="flex items-start gap-3 text-sm font-medium leading-6">
          <input name="adult" type="checkbox" required className="mt-1 size-5" />
          <span>I’m 18 or older, and I’ve read the <Link href="/privacy" className="font-bold underline">privacy notice</Link>.</span>
        </label>
        <button type="submit" className={primaryButtonClass}>Continue with Google</button>
      </form>
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
