import { defaultAiDeps } from "@/features/ai/deps";
import { handleStatus } from "@/features/ai/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether AI features are on. Makes no OpenAI call and reveals no configuration values. */
export async function GET() {
  return handleStatus(defaultAiDeps());
}
