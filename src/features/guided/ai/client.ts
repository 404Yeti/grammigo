import { parseOpinion, type OpinionResult } from "../cycle/opinion";

/**
 * Browser call for the AI second opinion. It never throws, and every failure is a neutral "failed"
 * result: the learner is never penalised for a network, quota or model problem.
 */
export async function requestOpinion(input: { itemId: string; text: string; source: "typed" | "spoken" }, signal?: AbortSignal): Promise<OpinionResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "failed", reason: "offline" };
  const controller = new AbortController();
  const timedOut = { value: false };
  const timer = setTimeout(() => {
    timedOut.value = true;
    controller.abort();
  }, 8_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch("/api/ai/guided-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 429) return { status: "failed", reason: "rate_limited" };
    if (res.status === 503) return { status: "failed", reason: "unavailable" };
    if (res.status === 504) return { status: "failed", reason: "timeout" };
    if (!res.ok) return { status: "failed", reason: "unavailable" };
    const body = (await res.json()) as { status?: string; opinion?: unknown };
    return body.status === "ok" ? parseOpinion(body.opinion) : { status: "failed", reason: "invalid" };
  } catch {
    return { status: "failed", reason: timedOut.value ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
