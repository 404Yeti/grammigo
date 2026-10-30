import { defaultAiDeps } from "@/features/ai/deps";
import { handleGoals } from "@/features/ai/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleGoals(request, defaultAiDeps());
}
