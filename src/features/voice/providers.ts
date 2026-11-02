import "server-only";
import { createSpeechClient } from "@/features/ai/deps";

export const CUSTOM_MIGO_VOICE = "v50G5ovlVt3QsSRU1EhH";
export const ELEVEN_MODEL = "eleven_multilingual_v2";
export const CORAL_IDENTITY = "openai:gpt-4o-mini-tts:coral";
export const MAX_AUDIO_BYTES = 256_000;

/** Bound a response while streaming, rather than buffering an untrusted provider body first. */
export async function readSpeechAudio(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("speech_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("speech_unavailable");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error("speech_unavailable"); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("speech_unavailable");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export function elevenLabsProvider(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return undefined;
  const requested = Number(env.ELEVENLABS_DAILY_CALL_CAP);
  const dailyCap = Number.isFinite(requested) && requested > 0 ? Math.min(50, Math.floor(requested)) : 20;
  return {
    identity: `elevenlabs:${ELEVEN_MODEL}:${CUSTOM_MIGO_VOICE}`,
    dailyCap,
    generate: async (text: string) => readSpeechAudio(await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${CUSTOM_MIGO_VOICE}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } }),
        signal: AbortSignal.timeout(5000), redirect: "error",
      },
    )),
  };
}

export async function generateCoral(input: string): Promise<Uint8Array> {
  const response = await createSpeechClient().create({
    model: "gpt-4o-mini-tts", voice: "coral", input, response_format: "mp3", speed: 0.95,
    instructions: "Read the supplied English grammar coaching text exactly. Speak warmly and clearly at a steady pace. Do not add words or sound effects.",
  }, { timeout: 7000, maxRetries: 0, signal: AbortSignal.timeout(7000) });
  return readSpeechAudio(response);
}
