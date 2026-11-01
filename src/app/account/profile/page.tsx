import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SlidersHorizontal, User } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { ButtonLink } from "@/components/ui/Button";
import { accountsEnabled } from "@/features/accounts/enabled";
import { PageFrame } from "@/features/accounts/PageFrame";
import { requireLearner } from "@/lib/auth/page";
import { readProfile } from "@/lib/auth/profile-api";

export const metadata: Metadata = { title: "Your profile — Grammigo", robots: { index: false, follow: false } };

export default function ProfilePage({ searchParams }: PageProps<"/account/profile">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/account/profile">["searchParams"] }) {
  const { viewer, client } = await requireLearner();
  const profile = await readProfile(client, viewer.id);
  if (!profile) notFound();
  const saved = (await searchParams).saved === "1";
  const since = new Date(profile.memberSince).toLocaleDateString("en", { month: "short", year: "numeric" });
  const p = profile.preferences;
  return (
    <PageFrame title="Profile" back={{ href: "/account", label: "Dashboard" }}>
      {saved && <p role="status" className="rounded-2xl bg-success-soft p-3 text-sm font-semibold" data-testid="profile-saved">Saved.</p>}
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="grid size-16 place-items-center rounded-full border border-brand bg-brand-soft text-2xl font-bold text-brand-text" aria-hidden>{profile.displayName.trim()[0]?.toUpperCase()}</span>
        <p className="text-2xl font-bold" data-testid="profile-name">{profile.displayName}</p>
        {profile.email && <p className="text-sm font-medium text-ink-2" data-testid="profile-email">{profile.email}</p>}
        <GrammarTag style="neutral">Member since {since}</GrammarTag>
      </div>
      <Card aria-labelledby="prefs">
        <h2 id="prefs" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.6px] text-muted"><SlidersHorizontal size={14} aria-hidden /> Learning preferences</h2>
        <dl className="mt-3 space-y-3 text-base font-medium">
          <div><dt className="text-ink-2">Practising</dt><dd className="font-bold" data-testid="profile-practising">{p.practising.length ? p.practising.join(", ") : "Not chosen yet"}</dd></div>
          <div><dt className="text-ink-2">Time each day</dt><dd className="font-bold" data-testid="profile-minutes">About {p.dailyMinutes} minutes</dd></div>
        </dl>
      </Card>
      <Card aria-labelledby="about">
        <h2 id="about" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.6px] text-muted"><User size={14} aria-hidden /> About you</h2>
        <dl className="mt-3 space-y-3 text-base font-medium">
          <div><dt className="text-ink-2">Display name</dt><dd className="font-bold">{profile.displayName}</dd></div>
          <div><dt className="text-ink-2">First language</dt><dd className="font-bold">{profile.firstLanguage ?? "Not set"}</dd></div>
        </dl>
      </Card>
      <ButtonLink href="/account/profile/edit" variant="secondary">Edit profile</ButtonLink>
      {viewer.isAdmin && <Link href="/account/invitations" className="text-center text-sm font-bold text-brand-text underline underline-offset-4">Manage invitations</Link>}
      <form action="/api/auth/signout" method="post">
        <button type="submit" className="min-h-11 w-full text-sm font-bold underline underline-offset-4">Sign out</button>
      </form>
    </PageFrame>
  );
}
