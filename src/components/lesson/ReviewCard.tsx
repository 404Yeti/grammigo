"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Eye, RotateCcw, X } from "lucide-react";
import type { Classification } from "@/types/session";
import { cn } from "@/lib/utils/cn";

export type ReviewResult = Classification | "needs_review";

const BADGE: Record<ReviewResult, { text: string; className: string; icon: React.ReactNode }> = {
  correct_first_try: {
    text: "Correct first try",
    className: "bg-success-soft text-success",
    icon: <Check size={13} strokeWidth={3} aria-hidden />,
  },
  correct_after_hint: {
    text: "Corrected after hint",
    className: "bg-warning-soft text-warning-text",
    icon: <RotateCcw size={13} aria-hidden />,
  },
  correct_after_retry: {
    text: "Corrected after retry",
    className: "bg-warning-soft text-warning-text",
    icon: <RotateCcw size={13} aria-hidden />,
  },
  incorrect: {
    text: "Not yet correct",
    className: "bg-error-soft text-error",
    icon: <X size={13} strokeWidth={3} aria-hidden />,
  },
  needs_review: {
    text: "Needs review",
    className: "bg-info-soft text-ink",
    icon: <Eye size={13} aria-hidden />,
  },
};

export interface ReviewDetail {
  label: string;
  value: string;
  tone?: "success";
}

interface ReviewCardProps {
  number: number;
  title: string;
  result: ReviewResult;
  details: ReviewDetail[];
  why: string;
  defaultOpen?: boolean;
}

/** Expandable answer review. “Independent” and “corrected after help” differ by label + icon, not colour alone. */
export function ReviewCard({ number, title, result, details, why, defaultOpen = false }: ReviewCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const badge = BADGE[result];

  return (
    <div className="rounded-[20px] border border-line bg-surface" data-testid="review-card" data-result={result}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-4 text-left"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-sm font-bold">
          {number}
        </span>
        <span className="flex flex-1 flex-col items-start gap-2">
          <span className="text-base font-semibold leading-6">{title}</span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold leading-4 tracking-[0.3px]", badge.className)}>
            {badge.icon}
            {badge.text}
          </span>
        </span>
        <ChevronDown size={18} aria-hidden className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={panelId} className="border-t border-line px-4 pb-4 pt-3 text-sm leading-5" data-testid="review-details">
          <dl className="space-y-3">
            {details.map((d) => (
              <div key={d.label}>
                <dt className="text-xs font-medium text-muted">{d.label}</dt>
                <dd className={cn("text-base font-medium leading-6", d.tone === "success" && "text-success")}>{d.value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-medium text-muted">Why</dt>
              <dd className="text-base font-medium leading-6">{why}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
