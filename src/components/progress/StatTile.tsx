import { cn } from "@/lib/utils/cn";

export type StatKind = "neutral" | "success" | "help";

const kinds: Record<StatKind, string> = {
  neutral: "border-line bg-surface",
  success: "border-success-border/40 bg-success-soft",
  help: "border-warning-soft bg-warning-soft",
};

/** Result stat tile: labels, not just numbers. “Independent” and “after feedback” are separate tiles. */
export function StatTile({
  kind = "neutral",
  value,
  label,
  valueClassName,
}: {
  kind?: StatKind;
  value: number | string;
  label: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("rounded-[20px] border p-[18px]", kinds[kind])} data-testid="stat-tile">
      <p className={cn("text-[40px] font-extrabold leading-[48px] tracking-[-0.5px]", kind === "success" && "text-success", valueClassName)}>
        {value}
      </p>
      <p className="mt-1 text-xs font-bold leading-4 tracking-[0.6px] text-ink-2">{label}</p>
    </div>
  );
}
