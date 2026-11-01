import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listTopics } from "@/curriculum";
import { accountsEnabled } from "@/features/accounts/enabled";
import { PageFrame } from "@/features/accounts/PageFrame";
import { ProfileForm } from "@/features/accounts/ProfileForm";
import { requireLearner } from "@/lib/auth/page";
import { readProfile } from "@/lib/auth/profile-api";

export const metadata: Metadata = { title: "Edit profile — Grammigo", robots: { index: false, follow: false } };

export default function EditProfilePage() {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const { viewer, client } = await requireLearner();
  const profile = await readProfile(client, viewer.id);
  if (!profile) notFound();
  return (
    <PageFrame title="Edit profile" back={{ href: "/account/profile", label: "Profile" }}>
      <ProfileForm
        topics={listTopics()}
        initial={{ displayName: profile.displayName, firstLanguage: profile.firstLanguage ?? "", practising: profile.preferences.practising, dailyMinutes: profile.preferences.dailyMinutes }}
      />
    </PageFrame>
  );
}
