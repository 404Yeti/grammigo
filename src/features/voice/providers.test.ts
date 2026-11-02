// @vitest-environment node
import { expect, it, vi } from "vitest";
import { CUSTOM_MIGO_VOICE, ELEVEN_MODEL, elevenLabsProvider, MAX_AUDIO_BYTES, readSpeechAudio } from "./providers";

it("uses only the server key and the fixed custom voice/model, with bounded timeout and no redirect", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }));
  expect(elevenLabsProvider({})).toBeUndefined();
  const provider = elevenLabsProvider({ ELEVENLABS_API_KEY: "server-only-test", ELEVENLABS_DAILY_CALL_CAP: "500" }, fetcher)!;
  expect(provider.dailyCap).toBe(50);
  expect(await provider.generate("Authored instruction.")).toEqual(new Uint8Array([1, 2]));
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(`/v1/text-to-speech/${CUSTOM_MIGO_VOICE}?output_format=mp3_44100_128`);
  expect(init.headers).toMatchObject({ "xi-api-key": "server-only-test" });
  expect(JSON.parse(init.body as string)).toMatchObject({ text: "Authored instruction.", model_id: ELEVEN_MODEL });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(init.redirect).toBe("error");
});
it("rejects provider errors, non-audio, empty audio and oversized streaming output without returning raw errors", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const provider = elevenLabsProvider({ ELEVENLABS_API_KEY: "server-only-test" }, vi.fn(async () => new Response("private provider error", { status })))!;
    await expect(provider.generate("Public prompt")).rejects.toThrow("speech_unavailable");
  }
  await expect(readSpeechAudio(new Response("not audio"))).rejects.toThrow("speech_unavailable");
  await expect(readSpeechAudio(new Response(new Uint8Array(), { headers: { "content-type": "audio/mpeg" } }))).rejects.toThrow("speech_unavailable");
  await expect(readSpeechAudio(new Response(new Uint8Array(MAX_AUDIO_BYTES + 1), { headers: { "content-type": "audio/mpeg" } }))).rejects.toThrow("speech_unavailable");
});
