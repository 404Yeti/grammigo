import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";

/** The frame of an account sub-page: the usual navigation, a back link, a title. */
export function PageFrame({ title, back, children }: { title: string; back: { href: string; label: string }; children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[640px] px-4 pb-8 pt-3 lg:px-14 lg:pt-5">
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-ink-2 hover:underline">
          <ChevronLeft size={18} aria-hidden /> {back.label}
        </Link>
        <h1 className="mt-1 text-[32px] font-extrabold leading-10 tracking-[-0.5px]">{title}</h1>
        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </div>
    </AppShell>
  );
}
