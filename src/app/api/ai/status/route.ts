import { connection } from "next/server";
import { defaultAiDeps } from "@/features/ai/deps";
import { handleStatus } from "@/features/ai/handlers";

/**
 * Reports whether AI features are on. Makes no OpenAI call and reveals no configuration values.
 * `connection()` makes this dynamic, so environment values are read per request, not frozen at build time.
 */
export async function GET() {
  await connection();
  return handleStatus(defaultAiDeps());
}
