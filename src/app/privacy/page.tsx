import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/features/marketing/SiteNav";
import { SiteFooter } from "@/features/marketing/SiteFooter";
import { accountsEnabled } from "@/features/accounts/enabled";
import { PrivacyAccounts } from "@/features/accounts/PrivacyAccounts";

export const metadata: Metadata = { title: "Privacy — Grammigo" };

export default function PrivacyPage() {
  return (
    <div className="bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-5 py-12 lg:py-16">
      <h1 className="text-[28px] font-extrabold leading-9 tracking-[-0.4px]">Privacy</h1>
      {accountsEnabled() && <PrivacyAccounts />}
      {!accountsEnabled() && (
      <section className="space-y-2 text-sm font-medium leading-6 text-ink-2">
        <h2 className="text-base font-bold text-ink">Stays on your device</h2>
        <p>
          Grammigo has no accounts. Your lessons, answers and progress are saved only in this browser (local storage). Clearing
          your browser data removes them.
        </p>
        <h2 className="pt-2 text-base font-bold text-ink">Sent to an AI service (only when AI features are on)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>What you type</b> about your grammar goals, and <b>short written answers</b>, are sent to OpenAI to
            understand your goals and give feedback.
          </li>
          <li>
            <b>Voice:</b> if you choose to speak, your recording (up to 30 seconds) is sent to OpenAI to be turned into text.
            You can read and edit that text before anything else happens. Grammigo does not store the recording.
          </li>
          <li>
            AI never grades multiple-choice or fill-in answers and never lowers your result. If AI is unavailable, Grammigo
            keeps working without it.
          </li>
          <li>Please don’t include personal details (names, addresses, ID numbers) in what you type or say.</li>
        </ul>
        <h2 className="pt-2 text-base font-bold text-ink">What the server keeps</h2>
        <p>
          To prevent abuse, Grammigo counts requests per visitor using a one-way hash of the network address, held for at most
          a day. Usage logs contain counts only, never your text or audio.
        </p>
        <h2 className="pt-2 text-base font-bold text-ink">OpenAI</h2>
        <p>
          OpenAI processes what is sent to it under its own terms and data-retention policy. See OpenAI’s privacy policy for
          how long it may keep API data.
        </p>
      </section>
      )}
      <Link href="/learn" className="mt-2 text-sm font-bold underline">
        Back to Grammigo
      </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
