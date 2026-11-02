#!/usr/bin/env node
// Supply the key securely in the process environment. Never pass it as an argument or print it.
import { writeFile } from "node:fs/promises";
const voice = "v50G5ovlVt3QsSRU1EhH";
const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) { console.error("ELEVENLABS_API_KEY is required in the server/terminal environment; do not paste it in chat."); process.exit(2); }
const headers = { "xi-api-key": key };
async function request(path, init = {}) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, { ...init, headers: { ...headers, ...init.headers }, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}; provider error bodies are intentionally not printed.`);
  return response;
}
try {
  const found = await (await request(`/v1/voices/${voice}`)).json();
  if (found.voice_id !== voice) throw new Error("The requested voice was not returned.");
  const result = { voiceId: voice, accountVoiceAccess: true, synthesisTested: false };
  if (process.argv.includes("--synthesize")) {
    const response = await request(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify({ text: "Hello, I’m Migo. Let’s practise English grammar together.", model_id: "eleven_multilingual_v2" }) });
    if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Expected audio.");
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256000) { await reader.cancel(); throw new Error("Audio exceeded256KB."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    if (!size) throw new Error("Empty audio.");
    const destination = process.env.MIGO_VOICE_SAMPLE_PATH || "/tmp/grammigo-elevenlabs-migo-sample.mp3";
    await writeFile(destination, Buffer.concat(chunks));
    Object.assign(result, { synthesisTested: true, audioBytes: size, sampleFile: destination, paidRequests: 1, humanListeningAcceptance: "pending" });
  }
  console.log(JSON.stringify(result));
} catch (error) { console.error(error instanceof Error ? error.message : "Voice verification failed."); process.exitCode = 1; }
