import { scopedKey } from "@/lib/scope/storage-scope";
export const POSITIVE_RESPONSES = [
  "Nailed it! Let’s keep going.",
  "Exactly right! You’re getting the hang of this.",
  "Perfect! On to the next one.",
] as const;
const memory = new Map<string, { last: number; event: string; variant: number }>();
export function positiveVariant(event: string): number {
  const key = scopedKey("grammigo:positive:v1");
  let previous = memory.get(key);
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (raw && Number.isInteger(raw.last) && raw.last >= 0 && raw.last < 3 && typeof raw.event === "string" && raw.variant === raw.last) previous = raw;
  } catch { /* memory fallback */ }
  if (previous?.event === event) return previous.variant;
  const variant = ((previous?.last ?? -1) + 1) % 3;
  const next = { last: variant, event, variant };
  memory.set(key, next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* memory fallback */ }
  return variant;
}
