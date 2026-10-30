import { defaultAiDeps } from "@/features/ai/deps";
import { handleWriting } from "@/features/ai/handlers";


export async function POST(request: Request) {
  return handleWriting(request, defaultAiDeps());
}
