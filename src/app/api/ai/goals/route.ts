import { defaultAiDeps } from "@/features/ai/deps";
import { handleGoals } from "@/features/ai/handlers";


export async function POST(request: Request) {
  return handleGoals(request, defaultAiDeps());
}
