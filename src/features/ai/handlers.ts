import { getCurriculumSkill } from "@/curriculum";
import { aiAvailability, type AiConfig } from "@/lib/ai/config";
import { guardRequest, json, type AiKind } from "@/lib/ai/guard";
import type { RateLimiter } from "@/lib/ai/rate-limit";
import { goalsRequestSchema, writingRequestSchema } from "./schemas";
import { AiError, type AiService } from "./service";

export interface AiDeps {
  config: AiConfig;
  limiter: RateLimiter;
  /** Built lazily so no OpenAI client exists until every guard has passed. */
  service: () => AiService;
}

const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a"]);
const BODY_OVERHEAD = 10_000;

/** What went wrong, never why: no learner text, model output or key material reaches the client or logs. */
function failure(error: unknown): Response {
  const code = error instanceof AiError ? error.code : "upstream";
  console.warn(`[ai] request failed: ${code}`);
  return json(code === "timeout" ? 504 : 502, { error: code });
}

async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export async function handleStatus(deps: AiDeps): Promise<Response> {
  const a = aiAvailability(deps.config);
  return json(200, a.available ? { available: true, features: { goals: true, transcribe: true, writing: true } } : { available: false, reason: a.reason, features: { goals: false, transcribe: false, writing: false } });
}

async function guarded(req: Request, kind: AiKind, deps: AiDeps, maxBody: number): Promise<Response | null> {
  const g = await guardRequest(req, kind, deps.config, deps.limiter, maxBody);
  return g.ok ? null : g.response;
}

export async function handleGoals(req: Request, deps: AiDeps): Promise<Response> {
  const blocked = await guarded(req, "goals", deps, 4_000);
  if (blocked) return blocked;
  const parsed = goalsRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(400, { error: "invalid_request" });
  try {
    const result = await deps.service().extractGoals(parsed.data.text);
    return json(200, { status: "ok", ...result });
  } catch (error) {
    return failure(error);
  }
}

export async function handleWriting(req: Request, deps: AiDeps): Promise<Response> {
  const blocked = await guarded(req, "writing", deps, 4_000);
  if (blocked) return blocked;
  const parsed = writingRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const skill = getCurriculumSkill(parsed.data.skillId);
  if (!skill) return json(400, { error: "invalid_request" });
  try {
    const feedback = await deps.service().evaluateWriting({ skill, questionId: parsed.data.questionId, text: parsed.data.text });
    return json(200, { status: "ok", feedback });
  } catch (error) {
    return failure(error);
  }
}

export async function handleTranscribe(req: Request, deps: AiDeps): Promise<Response> {
  const max = deps.config.limits.audioBytesMax;
  const blocked = await guarded(req, "transcribe", deps, max + BODY_OVERHEAD);
  if (blocked) return blocked;

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("audio");
  } catch {
    return json(400, { error: "invalid_request" });
  }
  if (!(file instanceof Blob) || file.size === 0) return json(400, { error: "invalid_request" });
  if (file.size > max) return json(413, { error: "too_large" });
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!AUDIO_TYPES.has(type)) return json(415, { error: "unsupported_type" });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await deps.service().transcribe({ bytes, name: `speech.${type.split("/")[1].replace("x-", "")}`, type });
    return json(200, { status: "ok", text });
  } catch (error) {
    return failure(error);
  }
}
