import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "default" | "brand" | "subtle";

const tones: Record<Tone, string> = {
  default: "border-line bg-surface",
  brand: "border-brand bg-brand-soft",
  subtle: "border-line bg-subtle",
};

export function Card({
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div className={cn("rounded-[20px] border p-5", tones[tone], className)} {...props} />
  );
}
