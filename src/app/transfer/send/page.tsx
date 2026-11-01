import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/layout/Wordmark";
import { transferEnabled } from "@/features/transfer/config";
import { SendPanel } from "@/features/transfer/SendPanel";

export const metadata: Metadata = { title: "Send your progress — Grammigo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function TransferSendPage() {
  if (!transferEnabled()) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 px-4 pb-10 pt-6">
      <Wordmark />
      <h1 className="text-[28px] font-extrabold leading-9 tracking-[-0.4px]">Send your progress</h1>
      <SendPanel />
    </main>
  );
}
