import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AuthShell } from "@/features/accounts/AuthShell";
import { Dashboard } from "@/features/accounts/Dashboard";
import { accountsEnabled } from "@/features/accounts/enabled";
import { requireLearner } from "@/lib/auth/page";
import { readProfile } from "@/lib/auth/profile-api";

export const metadata: Metadata = { title: "Your dashboard — Grammigo", robots: { index: false, follow: false } };

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={<AuthShell title="Your dashboard"><p className="text-sm font-medium text-ink-2">Checking your session…</p></AuthShell>}>
      <DashboardPage searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardPage({ searchParams }: { searchParams: PageProps<"/account">["searchParams"] }) {
  // Nothing below renders for anyone who is not an active learner (see requireLearner).
  const { viewer, client } = await requireLearner();
  const profile = await readProfile(client, viewer.id);
  const welcome = (await searchParams).welcome === "1";
  return <Dashboard userId={viewer.id} displayName={viewer.displayName} practising={profile?.preferences.practising ?? []} welcome={welcome} />;
}
