import type { GoalItem } from "@/types/session";
import type { WritingFeedback } from "./schemas";

/**
 * Browser-side wrappers for the AI endpoints. Every call has a timeout and NEVER throws: a null
 * result means "not available right now" and the caller falls back (typing, local matching,
 * "saved for review"). Nothing here ever sees an API key.
 */

async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  try {
    const res = await fetch(path, { ...init, signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export interface AiStatus {
  available: boolean;
}

export async function fetchAiStatus(): Promise<AiStatus> {
  const out = await call<AiStatus>("/api/ai/status", { method: "GET" }, 4000);
  return { available: out?.available === true };
}

export async function requestGoals(text: string): Promise<{ goals: GoalItem[]; skillIds: string[]; summary: string } | null> {
  const out = await call<{ status: string; goals: GoalItem[]; skillIds: string[]; summary: string }>(
    "/api/ai/goals",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
    10_000,
  );
  return out?.status === "ok" ? { goals: out.goals, skillIds: out.skillIds, summary: out.summary } : null;
}

export async function requestTranscription(audio: Blob, signal?: AbortSignal): Promise<string | null> {
  const body = new FormData();
  body.set("audio", audio, "speech.webm");
  const out = await call<{ status: string; text: string }>("/api/ai/transcribe", { method: "POST", body, signal }, 22_000);
  return out?.status === "ok" ? out.text : null;
}

export async function requestWritingFeedback(input: { skillId: string; questionId: string; text: string }): Promise<WritingFeedback | null> {
  const out = await call<{ status: string; feedback: WritingFeedback }>(
    "/api/ai/writing-feedback",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    14_000,
  );
  return out?.status === "ok" ? out.feedback : null;
}
