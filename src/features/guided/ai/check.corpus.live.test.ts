// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { listSkills } from "@/curriculum";
import { getGuidedItem } from "@/curriculum/guided";
import type { AiDeps } from "@/features/ai/handlers";
import { createAiService, type OpenAiLike } from "@/features/ai/service";
import { readAiConfig } from "@/lib/ai/config";
import { MemoryRateLimiter } from "@/lib/ai/rate-limit";
import { usageMeter } from "@/lib/ai/usage";
import { DEV } from "../evaluator/corpus/dev";
import { HOLDOUT } from "../evaluator/corpus/holdout";
import { HOLDOUT2 } from "../evaluator/corpus/holdout2";
import { HOLDOUT3 } from "../evaluator/corpus/holdout3";
import { ITEM_ID } from "../evaluator/corpus/helpers";
import { runCorpus } from "../evaluator/score";
import { decideOnOpinion, parseOpinion } from "../cycle/opinion";
import { handleGuidedCheck } from "./check";

/**
 * LIVE: what the AI second opinion says about EVERY labelled sentence the on-device check leaves uncertain
 * (the only sentences that ever reach it). Skipped unless GUIDED_LIVE_CORPUS=1. Development configuration, no deployment.
 *
 *   GUIDED_LIVE_CORPUS=1 npx vitest run src/features/guided/ai/check.corpus.live.test.ts
 *
 * It measures; it does not tune anything. The question it answers: when the AI is asked about an uncertain answer,
 * does it ever (a) confirm a sentence that is really wrong, or (b) raise a grammar concern about a sentence that is fine?
 */
try {
  process.loadEnvFile(join(process.cwd(), ".env.local"));
} catch {
  /* skip */
}
const config = readAiConfig(process.env);
const ready = process.env.GUIDED_LIVE_CORPUS === "1" && config.enabled && !!config.apiKey;

describe.skipIf(!ready)("AI second opinion on every uncertain labelled sentence (development configuration)", () => {
  it("measures confirm / concern rates against the labels", async () => {
    const deps: AiDeps = {
      config,
      limiter: new MemoryRateLimiter(),
      service: () => {
        const client = new OpenAI({ apiKey: config.apiKey ?? undefined, maxRetries: 0 });
        return createAiService(client as unknown as OpenAiLike, config, listSkills(), (e) => usageMeter.record(e));
      },
    };
    const uncertain = runCorpus([...DEV, ...HOLDOUT, ...HOLDOUT2, ...HOLDOUT3]).filter((s) => s.got.verdict === "uncertain" && !s.got.notAnAttempt);
    const rows: Record<string, unknown>[] = [];
    for (const s of uncertain) {
      deps.limiter = new MemoryRateLimiter();
      const text = JSON.stringify({ itemId: ITEM_ID[s.case.item], text: s.case.text, source: s.case.source });
      const started = Date.now();
      const res = await handleGuidedCheck(new Request("http://localhost/api/ai/guided-check", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost", "content-length": String(text.length) }, body: text }), deps);
      const body = (await res.json()) as { opinion?: unknown };
      const parsed = res.status === 200 ? parseOpinion(body.opinion) : null;
      const item = getGuidedItem(ITEM_ID[s.case.item])!;
      const opinion = parsed?.status === "ok" ? parsed.opinion : null;
      if (opinion?.suspected) expect(item.categories).toContain(opinion.suspected);
      rows.push({
        item: ITEM_ID[s.case.item], text: s.case.text, label: s.case.expect, labelCategory: s.case.category ?? null, evaluatorSuspected: s.got.suspected,
        http: res.status, ms: Date.now() - started, fit: opinion?.fit ?? null, confidence: opinion?.confidence ?? null, aiSuspected: opinion?.suspected ?? null,
        decision: opinion ? decideOnOpinion(opinion, { clarificationsUsed: 0, itemCategories: item.categories }).action : "failed",
      });
    }
    const by = (label: string) => rows.filter((r) => r.label === label);
    const count = (rs: Record<string, unknown>[], f: (r: Record<string, unknown>) => boolean) => rs.filter(f).length;
    const summary = {
      sentencesReachingTheAi: rows.length,
      byLabel: Object.fromEntries(["correct", "uncertain", "incorrect"].map((l) => [l, by(l).length])),
      confirmedAsFit_highConfidence: {
        ofLabelledCorrect: count(by("correct"), (r) => r.decision === "accept_fit"),
        ofLabelledAmbiguous: count(by("uncertain"), (r) => r.decision === "accept_fit"),
        ofLabelledIncorrect_WRONGLY_CREDITED: count(by("incorrect"), (r) => r.decision === "accept_fit"),
      },
      grammarConcern_clarify: {
        ofLabelledCorrect_FALSE_GUIDANCE: count(by("correct"), (r) => r.fit === "grammar_concern" && r.decision === "clarify"),
        ofLabelledIncorrect_HELPFUL: count(by("incorrect"), (r) => r.fit === "grammar_concern" && r.decision === "clarify"),
        ofLabelledAmbiguous: count(by("uncertain"), (r) => r.fit === "grammar_concern" && r.decision === "clarify"),
      },
      failures: count(rows, (r) => r.http !== 200),
      avgMs: Math.round(rows.reduce((a, r) => a + (r.ms as number), 0) / rows.length),
      maxMs: Math.max(...rows.map((r) => r.ms as number)),
      estimatedUsd: Number(usageMeter.snapshot().byKind.guided.estimatedUsd.toFixed(6)),
    };
    mkdirSync(join(process.cwd(), "docs/guided-correction"), { recursive: true });
    writeFileSync(join(process.cwd(), "docs/guided-correction/live-ai-corpus.json"), JSON.stringify({ note: "Measured, not tuned. Development configuration; nothing deployed.", model: config.model, summary, rows }, null, 2) + "\n");
    expect(rows.length).toBeGreaterThan(20);
  }, 600_000);
});
