import { defaultAiDeps } from "@/features/ai/deps";
import { handleSpeaking } from "@/features/ai/handlers";

export async function POST(request: Request) {
  return handleSpeaking(request, defaultAiDeps());
}
