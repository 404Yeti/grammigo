import { defaultAiDeps } from "@/features/ai/deps";
import { handleTranscribe } from "@/features/ai/handlers";


export async function POST(request: Request) {
  return handleTranscribe(request, defaultAiDeps());
}
