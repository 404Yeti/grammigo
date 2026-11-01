import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/Wordmark";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 px-4 pb-10 pt-6">
      <Wordmark />
      <h1 className="text-[28px] font-extrabold leading-9 tracking-[-0.4px]">{title}</h1>
      {children}
    </main>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[14px] border-[1.5px] border-line-strong bg-subtle px-4 py-3 text-sm font-semibold leading-6 text-ink">
      {children}
    </p>
  );
}

export const primaryButtonClass =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-brand px-6 py-3.5 text-base font-bold leading-6 text-ink hover:bg-brand-600";
export const secondaryLinkClass =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-[14px] border-[1.5px] border-line-strong bg-surface px-6 py-3.5 text-base font-bold leading-6 text-ink hover:bg-subtle";
