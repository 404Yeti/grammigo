import { Migo, type MigoExpression } from "./Migo";

/** Migo's short, local reaction. One idea per bubble. */
export function MigoBubble({ expression, children }: { expression: MigoExpression; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5" data-testid="migo-bubble">
      <Migo expression={expression} size={66} />
      <p className="flex-1 rounded-2xl border border-line bg-surface px-3.5 py-3 text-sm font-medium leading-5 text-ink">
        {children}
      </p>
    </div>
  );
}
