import { defaultAiDeps } from "@/features/ai/deps";
import { handleGuidedCheck } from "@/features/guided/ai/check";

export async function POST(request: Request) {
  return handleGuidedCheck(request, defaultAiDeps());
}
