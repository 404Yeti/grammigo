import { defaultSpeechDeps, handleSpeech } from "@/features/voice/server";

export async function POST(request: Request) {
  return handleSpeech(request, defaultSpeechDeps());
}
