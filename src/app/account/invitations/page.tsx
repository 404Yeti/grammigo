import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { accountsEnabled } from "@/features/accounts/enabled";
import { InvitationManager } from "@/features/accounts/InvitationManager";
import { PageFrame } from "@/features/accounts/PageFrame";
import { requireLearner } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Invitations — Grammigo", robots: { index: false, follow: false } };

export default function InvitationsPage() {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  await requireLearner({ admin: true }); // anyone else gets a plain 404
  return (
    <PageFrame title="Invitations" back={{ href: "/account/profile", label: "Profile" }}>
      <InvitationManager />
    </PageFrame>
  );
}
