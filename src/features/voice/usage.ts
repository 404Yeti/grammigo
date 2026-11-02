/** Per-instance counts only. Billing is verified separately; Speech API responses do not expose billed tokens. */
const totals = { paidCalls: 0, failures: 0, cacheHits: 0, inputCharacters: 0, outputBytes: 0, elapsedMs: 0 };
export function recordSpeechUsage(entry: { characters?: number; bytes?: number; ms?: number; failed?: boolean; cacheHit?: boolean }) {
  if (entry.cacheHit) { totals.cacheHits++; return; }
  totals.paidCalls++;
  totals.inputCharacters += entry.characters ?? 0;
  totals.outputBytes += entry.bytes ?? 0;
  totals.elapsedMs += entry.ms ?? 0;
  if (entry.failed) totals.failures++;
}
export function speechUsageSnapshot() {
  return { ...totals, billedUsd: null, note: "Instance-local counts only. Actual billed tokens/cost must be checked in OpenAI usage. No learner content is synthesized or logged." };
}
