import { defaultAiDeps } from "@/features/ai/deps";
import { handleWriting } from "@/features/ai/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleWriting(request, defaultAiDeps());
}
