import { afterEach, expect, it, vi } from "vitest";
import { requestTranscription } from "@/features/ai/client";

afterEach(() => vi.unstubAllGlobals());
it("aborts an in-flight upload without surfacing learner content or an error", async () => {
  let uploadSignal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_path, init) => new Promise((_resolve, reject) => {
    uploadSignal = init.signal;
    uploadSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const cancel = new AbortController();
  const pending = requestTranscription(new Blob(["private audio"], { type: "audio/mp4" }), cancel.signal);
  cancel.abort();
  expect(await pending).toBeNull();
  expect(uploadSignal.aborted).toBe(true);
});
it("returns only successful transcript text and treats a rate limit as unavailable", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", text: "Reviewed next" }) }).mockResolvedValueOnce({ ok: false, status: 429 });
  vi.stubGlobal("fetch", fetch);
  const blob = new Blob(["audio"], { type: "audio/webm" });
  expect(await requestTranscription(blob)).toBe("Reviewed next");
  expect(await requestTranscription(blob)).toBeNull();
  expect(fetch.mock.calls[0][0]).toBe("/api/ai/transcribe");
});
