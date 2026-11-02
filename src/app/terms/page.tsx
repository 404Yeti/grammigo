import type { Metadata } from "next";
import Link from "next/link";
import { accountsEnabled } from "@/features/accounts/enabled";
import { SiteFooter } from "@/features/marketing/SiteFooter";
import { SiteNav } from "@/features/marketing/SiteNav";

export const metadata: Metadata = { title: "Terms — Grammigo", description: "Plain-language terms of use (draft)." };

/** The terms from the website design. A DRAFT in plain language: it says so on the page, because it has not been reviewed by a lawyer. */
export default function TermsPage() {
  return (
    <div className="bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-5 py-12 lg:py-16">
        <h1 className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">Terms of use</h1>
        <p role="note" className="rounded-[14px] border-[1.5px] border-line-strong bg-subtle px-4 py-3 text-sm font-semibold leading-6">
          Draft: plain-language terms for an early pilot. They have not yet been reviewed by a lawyer and may change.
        </p>
        <section className="space-y-2 text-base font-medium leading-7 text-ink-2">
          <h2 className="text-xl font-bold text-ink">Using Grammigo</h2>
          <p>Use the app for personal learning. Be kind to others and don’t misuse the service.</p>
          <h2 className="pt-3 text-xl font-bold text-ink">AI guidance</h2>
          <p>Where Grammigo uses AI (to understand your goals or to comment on your writing), what it says is generated and may occasionally be wrong. Check important writing with a teacher.</p>
          <h2 className="pt-3 text-xl font-bold text-ink">Your account</h2>
          {accountsEnabled() ? (
            <p>Accounts are by invitation during the pilot. Keep your sign-in details safe. You can download your data or delete your account at any time from your profile.</p>
          ) : (
            <p>There are no accounts: your progress stays on your device, and you can clear it at any time by clearing this site’s data in your browser.</p>
          )}
          <h2 className="pt-3 text-xl font-bold text-ink">Changes</h2>
          <p>We’ll tell you about meaningful changes to these terms.</p>
        </section>
        <Link href="/privacy" className="text-sm font-bold underline underline-offset-4">Read the privacy notice</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
