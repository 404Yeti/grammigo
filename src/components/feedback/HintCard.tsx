import { Lightbulb } from "lucide-react";

export function HintCard({ index, total, text }: { index: number; total: number; text: string }) {
  return (
    <div
      role="note"
      data-testid="hint-card"
      className="rounded-[20px] border border-info-border bg-info-soft px-4 py-3.5"
    >
      <p className="flex items-center gap-1.5 text-xs font-bold leading-4 tracking-[0.6px] text-ink-2">
        <Lightbulb size={13} aria-hidden /> Hint {index} of {total}
      </p>
      <p className="mt-1 text-base font-medium leading-6 text-ink">{text}</p>
    </div>
  );
}
