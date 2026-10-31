import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { GuidedOutcomeKind } from "@/types/guided";
import { OUTCOME_LABEL } from "./copy";

type Tone = "info" | "warm" | "success" | "neutral" | "brand";
const TONE: Record<Tone, string> = {
  // Notice and hints use the calm info tone, never error red.
  info: "border-info-border bg-info-soft",
  warm: "border-line-strong bg-warning-soft",
  success: "border-success-border bg-success-soft",
  neutral: "border-line bg-subtle",
  brand: "border-brand bg-brand-soft",
};

export function InfoCard({ tone = "info", label, title, chip, children, testId }: { tone?: Tone; label?: string; title?: string; chip?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <section className={cn("rounded-[20px] border px-4 py-3.5", TONE[tone])} data-testid={testId}>
      {label && <p className="text-xs font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">{label}</p>}
      {chip && <div className="mt-1.5">{chip}</div>}
      {title && <h2 className="mt-1 text-xl font-bold leading-7 text-ink">{title}</h2>}
      {children && <div className="mt-1 text-base font-medium leading-6 text-ink-2">{children}</div>}
    </section>
  );
}

export function OutcomeChip({ kind }: { kind: GuidedOutcomeKind }) {
  return (
    <span
      data-testid="outcome-chip"
      data-outcome={kind}
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-bold leading-4 tracking-[0.3px]",
        kind === "unverified" ? "border border-line-strong bg-surface text-ink-2" : kind === "shown" ? "border border-line-strong bg-surface text-ink" : "border border-success-border bg-surface text-success",
      )}
    >
      {OUTCOME_LABEL[kind]}
    </span>
  );
}

export function RetryDots({ used, total }: { used: number; total: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium leading-4 text-ink-2" data-testid="retry-dots">
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("size-2 rounded-full", i < used ? "bg-brand" : "bg-sand")} />
        ))}
      </span>
      Retry {Math.min(used, total)} of {total}
    </p>
  );
}

/** One polite live region for the whole activity: every Migo prompt and every recording or transcription state lands here. */
export function Announcer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="guided-announcer">
      {message}
    </div>
  );
}
