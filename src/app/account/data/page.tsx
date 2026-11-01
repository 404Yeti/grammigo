import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Database, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { accountsEnabled } from "@/features/accounts/enabled";
import { ExportButton } from "@/features/accounts/ExportButton";
import { PageFrame } from "@/features/accounts/PageFrame";
import { requireLearner } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Your data — Grammigo", robots: { index: false, follow: false } };

export default function DataPage() {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const { viewer } = await requireLearner();
  return (
    <PageFrame title="Your data" back={{ href: "/account/profile", label: "Profile" }}>
      <Card aria-labelledby="kept">
        <h2 id="kept" className="flex items-center gap-2 text-xl font-bold leading-7"><Database size={20} aria-hidden /> What your account holds</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-medium leading-6 text-ink-2">
          <li>Your Google email address and name, and the profile you set here.</li>
          <li>The date you confirmed you are 18 or older, and the notice versions you agreed to.</li>
          <li>Only if you turned saving on: your lesson answers, quick-check answers, goals and Guided Correction attempts (text, never audio).</li>
        </ul>
        <p className="mt-2 text-sm font-medium leading-6 text-ink-2">Read the full <Link href="/privacy" className="font-bold underline underline-offset-4">privacy notice</Link>.</p>
      </Card>
      <Card aria-labelledby="export">
        <h2 id="export" className="flex items-center gap-2 text-xl font-bold leading-7"><ShieldCheck size={20} aria-hidden /> Download my data</h2>
        <p className="mb-3 mt-2 text-sm font-medium leading-6 text-ink-2">A file with everything your account holds about you, only yours. It is made when you ask and is not kept anywhere else.</p>
        <ExportButton />
      </Card>
      <Card aria-labelledby="delete">
        <h2 id="delete" className="flex items-center gap-2 text-xl font-bold leading-7"><Trash2 size={20} aria-hidden /> Delete my account</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-ink-2">
          Permanently deletes your account and everything saved in it. {viewer.isAdmin ? "The owner account can’t be deleted here." : "You will be asked to sign in with Google again first."}
        </p>
        {!viewer.isAdmin && <Link href="/account/delete" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-error underline underline-offset-4" data-testid="delete-link">Delete my account…</Link>}
      </Card>
    </PageFrame>
  );
}
