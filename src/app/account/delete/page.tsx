import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { accountsEnabled } from "@/features/accounts/enabled";
import { DeleteAccountForm } from "@/features/accounts/DeleteAccountForm";
import { PageFrame } from "@/features/accounts/PageFrame";
import { hasRecentSignIn } from "@/lib/auth/lifecycle";
import { requireLearner } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Delete account — Grammigo", robots: { index: false, follow: false } };

export default function DeletePage({ searchParams }: PageProps<"/account/delete">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

const NOTES: Record<string, string> = {
  rate: "Too many tries. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Nothing was changed. Please try again in a moment.",
};

async function Body({ searchParams }: { searchParams: PageProps<"/account/delete">["searchParams"] }) {
  const { viewer, client, config } = await requireLearner();
  const e = (await searchParams).e;
  const note = typeof e === "string" && Object.hasOwn(NOTES, e) ? NOTES[e] : null;
  const recent = await hasRecentSignIn(client, config.reauthWindowSeconds);
  return (
    <PageFrame title="Delete my account" back={{ href: "/account/data", label: "Your data" }}>
      {note && <p role="alert" className="rounded-2xl bg-error-soft p-3 text-sm font-semibold text-error">{note}</p>}
      <Card tone="subtle" aria-labelledby="what">
        <h2 id="what" className="flex items-center gap-2 text-xl font-bold leading-7"><AlertTriangle size={20} aria-hidden /> What deleting does</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-medium leading-6 text-ink-2">
          <li>Your account, profile, consents and everything saved online are deleted now. It can’t be undone, and we can’t recover it.</li>
          <li>You are signed out everywhere.</li>
          <li>Backups made before today may hold a copy for a limited time. If a backup is ever restored, your deletion is applied again. See the <Link href="/privacy" className="font-bold underline underline-offset-4">privacy notice</Link>.</li>
          <li>Progress on your devices stays unless you choose to remove it below. You can still practise as a guest.</li>
          <li>Want a copy first? <Link href="/account/data" className="font-bold underline underline-offset-4">Download your data</Link> before you delete.</li>
        </ul>
      </Card>
      {viewer.isAdmin ? (
        <p role="alert" className="rounded-2xl bg-warning-soft p-3 text-sm font-semibold">This is the owner account. It can’t be deleted here, so that the person who manages invitations is never removed by accident.</p>
      ) : recent ? (
        <DeleteAccountForm accountId={viewer.id} />
      ) : (
        <Card aria-labelledby="confirm" data-testid="reauth-card">
          <h2 id="confirm" className="text-xl font-bold leading-7">First, sign in again</h2>
          <p className="mb-3 mt-2 text-sm font-medium leading-6 text-ink-2">Before something that can’t be undone, choose your Google account again. You will come straight back here. Grammigo checks that the same account has just finished signing in. It cannot tell whether Google asked for your password.</p>
          <form action="/api/auth/reauth" method="post">
            <Button type="submit" data-testid="reauth-button">Sign in with Google again</Button>
          </form>
        </Card>
      )}
    </PageFrame>
  );
}
