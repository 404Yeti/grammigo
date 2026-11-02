import Link from "next/link";
import { Menu } from "lucide-react";
import { Wordmark } from "@/components/layout/Wordmark";
import { ButtonLink } from "@/components/ui/Button";

export const NAV_LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "About", href: "/#about" },
  { label: "FAQ", href: "/#faq" },
] as const;

/** The public site header: links and two buttons on a wide screen; a plain, script-free menu on a phone. */
export function SiteNav() {
  return (
    <header className="border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-5 lg:h-20 lg:px-20">
        <Link href="/" aria-label="Grammigo home" className="inline-flex min-h-11 items-center"><Wordmark className="text-2xl" /></Link>
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-2 hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <ButtonLink href="/signin" variant="secondary" fullWidth={false}>Sign in</ButtonLink>
          <ButtonLink href="/learn" fullWidth={false}>Get started</ButtonLink>
        </div>
        <details className="relative lg:hidden" data-testid="site-menu">
          <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-[14px] border-[1.5px] border-line-strong bg-surface" aria-label="Menu">
            <Menu size={22} aria-hidden />
          </summary>
          <div className="absolute right-0 top-14 z-20 flex w-[260px] flex-col gap-1 rounded-[20px] border border-line bg-surface p-3 shadow-lg">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-xl px-3 text-base font-semibold hover:bg-subtle">{l.label}</a>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <ButtonLink href="/signin" variant="secondary">Sign in</ButtonLink>
              <ButtonLink href="/learn">Get started</ButtonLink>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
