/**
 * Usage metering for AI calls: counts only. It never records prompts, learner text, transcripts,
 * model output or keys. Prices are ASSUMPTIONS (override with env vars) and must be checked
 * against OpenAI's current pricing page before being used for budgeting.
 */
export type UsageKind = "goals" | "writing" | "transcribe";

export interface UsageEntry {
  kind: UsageKind;
  model: string;
  ok: boolean;
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
  audioSeconds?: number;
  audioBytes?: number;
  /** Transcription only: lowest no-speech probability across segments (a number, not content). */
  minNoSpeechProb?: number;
  segments?: number;
}

export interface Prices {
  /** USD per 1M input tokens. */
  inPerM: number;
  /** USD per 1M output tokens. */
  outPerM: number;
  /** USD per minute of audio transcribed. */
  transcribePerMin: number;
}

export const DEFAULT_PRICES: Prices = { inPerM: 0.15, outPerM: 0.6, transcribePerMin: 0.006 };

export function estimateUsd(e: UsageEntry, p: Prices = DEFAULT_PRICES): number {
  if (e.kind === "transcribe") return ((e.audioSeconds ?? 0) / 60) * p.transcribePerMin;
  return ((e.promptTokens ?? 0) / 1e6) * p.inPerM + ((e.completionTokens ?? 0) / 1e6) * p.outPerM;
}

export interface UsageTotals {
  calls: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  audioSeconds: number;
  estimatedUsd: number;
  avgMs: number;
}

export class UsageMeter {
  private entries: UsageEntry[] = [];
  constructor(private prices: Prices = DEFAULT_PRICES) {}

  setPrices(prices: Prices): void {
    this.prices = prices;
  }

  record(entry: UsageEntry): number {
    this.entries.push(entry);
    if (this.entries.length > 2000) this.entries.shift();
    return estimateUsd(entry, this.prices);
  }

  reset(): void {
    this.entries = [];
  }

  snapshot(): { byKind: Record<UsageKind, UsageTotals>; total: UsageTotals; prices: Prices; note: string } {
    const empty = (): UsageTotals => ({ calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, audioSeconds: 0, estimatedUsd: 0, avgMs: 0 });
    const byKind: Record<UsageKind, UsageTotals> = { goals: empty(), writing: empty(), transcribe: empty() };
    const total = empty();
    for (const e of this.entries) {
      for (const t of [byKind[e.kind], total]) {
        t.calls += 1;
        if (!e.ok) t.failed += 1;
        t.promptTokens += e.promptTokens ?? 0;
        t.completionTokens += e.completionTokens ?? 0;
        t.audioSeconds += e.audioSeconds ?? 0;
        t.estimatedUsd += estimateUsd(e, this.prices);
        t.avgMs += e.ms;
      }
    }
    for (const t of [...Object.values(byKind), total]) t.avgMs = t.calls ? Math.round(t.avgMs / t.calls) : 0;
    return { byKind, total, prices: this.prices, note: "Estimates use assumed prices; verify against OpenAI's current pricing." };
  }
}

/** Process-wide meter (per server instance). */
export const usageMeter = new UsageMeter();
