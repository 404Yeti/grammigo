import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost";

const base =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] px-6 py-3.5 text-base font-bold leading-6 transition-colors disabled:cursor-not-allowed disabled:border-[1.5px] disabled:border-line disabled:bg-subtle disabled:text-muted";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-ink hover:bg-brand-600 active:bg-brand-600",
  secondary: "border-[1.5px] border-line-strong bg-surface text-ink hover:bg-subtle",
  dark: "bg-inverse text-on-inverse hover:bg-ink",
  ghost: "bg-transparent text-ink hover:bg-subtle",
};

interface CommonProps {
  variant?: ButtonVariant;
  /** Full width by default; turn off inside a button row. */
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  fullWidth = true,
  className,
  type = "button",
  ...props
}: CommonProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return <button type={type} className={cn(base, fullWidth && "w-full", variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  fullWidth = true,
  className,
  href,
  children,
}: CommonProps & { href: string }) {
  return (
    <Link href={href} className={cn(base, fullWidth && "w-full", variants[variant], className)}>
      {children}
    </Link>
  );
}
