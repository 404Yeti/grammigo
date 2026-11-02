import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { accountsEnabled } from "@/features/accounts/enabled";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-20">
        <Wordmark className="text-2xl" />
        <nav aria-label="Footer" className="flex gap-6 text-sm font-semibold text-ink-2">
          <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-ink">Privacy</Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-ink">Terms</Link>
          {accountsEnabled() && <Link href="/signin" className="inline-flex min-h-11 items-center hover:text-ink">Sign in</Link>}
        </nav>
        <p className="text-xs font-medium text-muted">© Grammigo</p>
      </div>
    </footer>
  );
}
