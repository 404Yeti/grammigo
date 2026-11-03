// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleSpeaking } from "@/features/ai/handlers";
import { createAiService, type OpenAiLike } from "@/features/ai/service";
import { readAiConfig } from "@/lib/ai/config";
import { MemoryRateLimiter } from "@/lib/ai/rate-limit";
import { listSkills } from "@/curriculum";

const feedback = { outcome: "meets_goal", confidence: "high", errors: [], suggestedCorrection: null, explanation: "You matched am to I correctly.", example: null, assessedSkillIds: ["a1-be-present"] };
function setup(output: unknown = feedback) {
  const create = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  const config = readAiConfig({ AI_FEATURES_ENABLED: "true", OPENAI_API_KEY: "fake", NODE_ENV: "development" });
  const client = { chat: { completions: { create } } } as unknown as OpenAiLike;
  return { create, deps: { config, limiter: new MemoryRateLimiter(), service: () => createAiService(client, config, listSkills()) } };
}
function request(body: unknown, origin = "https://grammigo.test") {
  const text = JSON.stringify(body);
  return new Request("https://grammigo.test/api/ai/speaking-feedback", { method: "POST", headers: { origin, host: "grammigo.test", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text });
}
const input = { skillId: "a1-be-present", questionId: "final-speaking", text: "I am happy. My friend is kind." };
describe("bounded speaking assessment", () => {
  it("uses the existing structured service with server-selected target and confirmed text", async () => {
    const { deps, create } = setup();
    const response = await handleSpeaking(request(input), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).feedback).toEqual(feedback);
    const args = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(JSON.stringify(args[0])).toContain("learner-confirmed transcription");
    expect(JSON.stringify(args[0])).toContain("one specific improvement");
    expect(JSON.stringify(args[0])).toContain("untrusted data");
  });
  it.each([{ ...input, skillId: "invented" }, { ...input, questionId: "q1" }, { ...input, text: "x".repeat(501) }, { ...input, prompt: "arbitrary conversation" }])("refuses arbitrary tasks before calling AI", async body => {
    const { deps, create } = setup();
    expect((await handleSpeaking(request(body), deps)).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("retains origin and availability guards", async () => {
    const { deps, create } = setup();
    expect((await handleSpeaking(request(input, "https://evil.test"), deps)).status).toBe(403);
    deps.config.enabled = false;
    expect((await handleSpeaking(request(input), deps)).status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
  it("turns low confidence into unclear and rejects malformed provider output", async () => {
    const low = setup({ ...feedback, confidence: "low" });
    expect((await (await handleSpeaking(request(input), low.deps)).json()).feedback.outcome).toBe("unclear");
    expect((await handleSpeaking(request(input), setup({ bad: true }).deps)).status).toBe(502);
  });
});
