import OpenAI from "openai";
import { listSkills } from "@/curriculum";
import { readAiConfig } from "@/lib/ai/config";
import { limiterFor } from "@/lib/ai/guard";
import { estimateUsd, usageMeter } from "@/lib/ai/usage";
import type { AiDeps } from "./handlers";
import { createAiService, type OpenAiLike } from "./service";

/** Production dependencies. The OpenAI client is created lazily, only after guards pass. */
export function defaultAiDeps(): AiDeps {
  const config = readAiConfig();
  return {
    config,
    limiter: limiterFor(config),
    service: () => {
      const client = new OpenAI({ apiKey: config.apiKey ?? undefined, maxRetries: 0 });
      usageMeter.setPrices(config.prices);
      return createAiService(client as unknown as OpenAiLike, config, listSkills(), (entry) => {
        usageMeter.record(entry);
        if (config.usageLog) {
          // Counts and timings only. Never content.
          console.info("[ai-usage]", JSON.stringify({ ...entry, estUsd: Number(estimateUsd(entry, config.prices).toFixed(6)) }));
        }
      });
    },
  };
}
