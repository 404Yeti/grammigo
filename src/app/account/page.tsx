import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, secondaryLinkClass } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { loadAuthConfig } from "@/lib/auth/config";
import { CookieSession } from "@/lib/auth/cookie-session";
import { createSessionClient } from "@/lib/auth/supabase";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Your account — Grammigo", robots: { index: false, follow: false } };

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  if (!accountsEnabled()) notFound();
  return (
    <Suspense fallback={<AuthShell title="Your account"><p className="text-sm font-medium text-ink-2">Checking your session…</p></AuthShell>}>
      <AccountBody searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountBody({ searchParams }: { searchParams: PageProps<"/account">["searchParams"] }) {
  // Everything below depends on who is asking and on the current time (the session library reads the clock). Declaring that first keeps
  // it out of any prerender, including the runtime prerender used for prefetching.
  await connection();
  const state = loadAuthConfig();
  if (state.state !== "ready") notFound();
  const jar = new CookieSession((await cookies()).getAll());
  const viewer = await getViewer(createSessionClient(state.config, jar));

  // Nothing below this point renders for anyone who is not an active learner. A session without a profile learns nothing, not even
  // whether an account exists for the address behind it.
  if (viewer.kind === "anonymous") redirect("/signin?e=session");
  if (viewer.kind === "no_profile") redirect("/auth/no-account");

  const welcome = (await searchParams).welcome === "1";
  return (
    <AuthShell title={`Hi, ${viewer.displayName}`}>
      {welcome && <p role="status" className="text-sm font-semibold text-ink">Welcome to Grammigo. Your account is ready.</p>}
      <p className="text-sm font-medium leading-6 text-ink-2">You’re signed in. Your lessons and progress still work exactly as before.</p>
      <Link href="/" className={secondaryLinkClass}>Back to Grammigo</Link>
      <form action="/api/auth/signout" method="post">
        <button type="submit" className={secondaryLinkClass}>Sign out</button>
      </form>
    </AuthShell>
  );
}
