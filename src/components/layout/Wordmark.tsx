import { cn } from "@/lib/utils/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-xl font-bold leading-7", className)} aria-label="Grammigo">
      <span className="text-ink">grammi</span>
      <span className="text-brand-text">go</span>
    </span>
  );
}
