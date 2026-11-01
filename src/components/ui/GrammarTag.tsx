import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type TagStyle = "brand" | "neutral" | "success" | "warning" | "info";

const styles: Record<TagStyle, string> = {
  brand: "bg-brand-soft text-brand-text",
  neutral: "bg-subtle text-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning-text",
  info: "bg-info-soft text-ink",
};

/** Skill, level, exercise-type and status chip. Always text first; colour is supportive. */
export function GrammarTag({
  style = "brand",
  className,
  children,
  ...rest
}: {
  style?: TagStyle;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children" | "style">) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold leading-4 tracking-[0.6px]",
        styles[style],
        className,
      )}
    >
      {children}
    </span>
  );
}
