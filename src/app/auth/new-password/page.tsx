import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice, primaryButtonClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { NEW_PASSWORD_MESSAGES } from "@/features/accounts/messages";
import { requireLearner } from "@/lib/auth/page";
import { PASSWORD_MIN } from "@/lib/auth/password-policy";

export const metadata: Metadata = { title: "New password — Grammigo", robots: { index: false, follow: false } };

const field = "min-h-[52px] rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold";

export default function NewPasswordPage({ searchParams }: PageProps<"/auth/new-password">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/auth/new-password">["searchParams"] }) {
  await requireLearner(); // only inside a session for an account that has a profile (the reset link signs the person in)
  const e = (await searchParams).e;
  const text = typeof e === "string" && Object.hasOwn(NEW_PASSWORD_MESSAGES, e) ? NEW_PASSWORD_MESSAGES[e] : null;
  return (
    <AuthShell title="Choose a new password">
      {text && <Notice>{text}</Notice>}
      <p className="text-sm font-medium leading-6 text-ink-2">After you save it, you are signed out everywhere and sign in again with the new password.</p>
      <form action="/api/auth/password/update" method="post" className="flex flex-col gap-4" data-testid="new-password-form">
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          New password (at least {PASSWORD_MIN} characters)
          <input name="password" type="password" required minLength={PASSWORD_MIN} maxLength={72} autoComplete="new-password" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Type it again
          <input name="confirm" type="password" required minLength={PASSWORD_MIN} maxLength={72} autoComplete="new-password" className={field} />
        </label>
        <button type="submit" className={primaryButtonClass}>Save new password</button>
      </form>
    </AuthShell>
  );
}
