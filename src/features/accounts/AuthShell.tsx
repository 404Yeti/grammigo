import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/Wordmark";
import { Migo, type MigoExpression } from "@/components/mascot/Migo";

/**
 * The frame every account page shares. With `mascot` the heading becomes a friendly hero: Migo beside the title and a one-line welcome. Without it the
 * page keeps the plain heading (the error, confirmation and reset pages).
 */
export function AuthShell({ title, children, mascot, intro }: { title: string; children: ReactNode; mascot?: MigoExpression; intro?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 px-4 pb-10 pt-6">
      <Wordmark />
      {mascot ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-extrabold leading-9 tracking-[-0.4px]">{title}</h1>
            {intro && <p className="mt-1 text-base font-medium leading-6 text-ink-2">{intro}</p>}
          </div>
          <Migo expression={mascot} size={84} className="shrink-0" />
        </div>
      ) : (
        <h1 className="text-[28px] font-extrabold leading-9 tracking-[-0.4px]">{title}</h1>
      )}
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
export const secondaryButtonClass = secondaryLinkClass;
