import { Check, RotateCcw, Eye } from "lucide-react";
import type { ReactNode } from "react";
import { Migo, type MigoExpression } from "@/components/mascot/Migo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export type FeedbackKind = "correct-independent" | "correct-assisted" | "incorrect" | "exhausted" | "needs-review";

interface FeedbackPanelProps {
  kind: FeedbackKind;
  title: string;
  body: string;
  /** Pre-authored explanation revealed by “Why?”. */
  why?: string | null;
  canHint?: boolean;
  onWhy?: () => void;
  onHint?: () => void;
  onRetry?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueRef?: React.Ref<HTMLButtonElement>;
  children?: ReactNode;
}

const tone: Record<FeedbackKind, string> = {
  "correct-independent": "border-success-border bg-success-soft",
  "correct-assisted": "border-success-border bg-success-soft",
  incorrect: "border-error-border bg-error-soft",
  exhausted: "border-line-strong bg-subtle",
  "needs-review": "border-line-strong bg-warning-soft",
};

const titleTone: Record<FeedbackKind, string> = {
  "correct-independent": "text-success",
  "correct-assisted": "text-success",
  incorrect: "text-error",
  exhausted: "text-ink",
  "needs-review": "text-warning-text",
};

const migo: Record<FeedbackKind, MigoExpression> = {
  "correct-independent": "happy",
  "correct-assisted": "happy",
  incorrect: "encouraging",
  exhausted: "encouraging",
  "needs-review": "thinking",
};

const CHIP: Partial<Record<FeedbackKind, { text: string; className: string; icon: ReactNode }>> = {
  "correct-independent": {
    text: "Counts as independent",
    className: "bg-success-soft text-success",
    icon: <Check size={13} strokeWidth={3} aria-hidden />,
  },
  "correct-assisted": {
    text: "Corrected after help · tracked separately",
    className: "bg-warning-soft text-warning-text",
    icon: <RotateCcw size={13} aria-hidden />,
  },
  "needs-review": {
    text: "Needs review · not graded",
    className: "bg-warning-soft text-warning-text",
    icon: <Eye size={13} aria-hidden />,
  },
};

/** Bottom feedback sheet. Migo’s expression reflects the outcome; wrong answers name the rule. */
export function FeedbackPanel({
  kind,
  title,
  body,
  why,
  canHint,
  onWhy,
  onHint,
  onRetry,
  onContinue,
  continueLabel = "Continue",
  continueRef,
  children,
}: FeedbackPanelProps) {
  const chip = CHIP[kind];
  const isIncorrect = kind === "incorrect";

  return (
    <section
      aria-label="Feedback"
      data-testid="feedback-panel"
      data-kind={kind}
      className="relative flex flex-col gap-3"
    >
      {chip && (
        <span
          data-testid="feedback-chip"
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold leading-4",
            chip.className,
          )}
        >
          {chip.icon}
          {chip.text}
        </span>
      )}
      <div className={cn("rounded-[20px] border p-5", tone[kind])}>
        <div className="flex items-center gap-4">
          <Migo expression={migo[kind]} size={86} />
          <div className="flex-1">
            <h2 className={cn("text-xl font-bold leading-7", titleTone[kind])}>{title}</h2>
            <p className="mt-1 text-sm font-medium leading-5 text-ink-2">{body}</p>
          </div>
        </div>
        {why && (
          <p data-testid="why-text" className="mt-3 rounded-2xl bg-surface/80 px-4 py-3 text-sm font-medium leading-5 text-ink">
            <span className="font-bold">Why? </span>
            {why}
          </p>
        )}
        {children}
        <div className="mt-4 flex flex-col gap-2.5">
          {isIncorrect ? (
            <>
              <div className="flex gap-2.5">
                {!why && (
                  <Button variant="secondary" onClick={onWhy} className="w-auto flex-none px-5">
                    Why?
                  </Button>
                )}
                {canHint ? (
                  <Button variant="dark" onClick={onHint}>
                    Get a hint
                  </Button>
                ) : (
                  <Button variant="dark" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </div>
              {(why || canHint) && (
                <Button variant="ghost" onClick={onRetry} className="min-h-11 py-2">
                  Try again
                </Button>
              )}
            </>
          ) : (
            <Button variant="dark" onClick={onContinue} ref={continueRef}>
              {continueLabel}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
