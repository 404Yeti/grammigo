"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Home } from "lucide-react";
import type { ReactNode } from "react";
import { DEFAULT_LESSON_ID } from "@/data/lessons";
import { cn } from "@/lib/utils/cn";
import { Wordmark } from "./Wordmark";

const ITEMS = [
  { label: "Home", href: "/", icon: Home },
  { label: "Practice", href: `/practice/${DEFAULT_LESSON_ID}`, icon: BookOpen },
  { label: "Progress", href: null, icon: BarChart3 },
] as const;

function isActive(pathname: string, href: string | null): boolean {
  if (!href) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith("/practice");
}

function NavItem({ item, pathname, layout }: { item: (typeof ITEMS)[number]; pathname: string; layout: "bottom" | "side" }) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  const inner = (
    <>
      <span
        className={cn(
          "grid place-items-center rounded-full",
          layout === "bottom" ? "h-8 w-16" : "size-8",
          active && "bg-brand-soft",
        )}
      >
        <Icon size={20} aria-hidden className={active ? "text-ink" : "text-muted"} />
      </span>
      <span className={cn("text-xs", active ? "font-bold text-ink" : "font-medium text-muted")}>
        {item.label}
        {!item.href && <span className="sr-only"> (coming soon)</span>}
      </span>
    </>
  );
  const cls = cn(
    layout === "bottom"
      ? "flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5"
      : "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm",
    layout === "side" && active && "bg-brand-soft",
    !item.href && "cursor-not-allowed opacity-60",
  );
  return item.href ? (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cls}>
      {inner}
    </Link>
  ) : (
    <span aria-disabled="true" title="Coming soon" className={cls}>
      {inner}
    </span>
  );
}

/** Dashboard chrome: bottom navigation on mobile, 280 px sidebar from 1024 px. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-line bg-canvas p-6 lg:flex">
        <Wordmark className="px-2 text-2xl" />
        <nav aria-label="Main" className="flex flex-col gap-1">
          {ITEMS.map((item) => (
            <NavItem key={item.label} item={item} pathname={pathname} layout="side" />
          ))}
        </nav>
      </aside>
      <div className="pb-24 lg:pb-12">{children}</div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-canvas px-2 lg:hidden"
      >
        {ITEMS.map((item) => (
          <NavItem key={item.label} item={item} pathname={pathname} layout="bottom" />
        ))}
      </nav>
    </div>
  );
}
