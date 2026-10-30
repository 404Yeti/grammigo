import { connection } from "next/server";
import { json } from "@/lib/ai/guard";
import { usageMeter } from "@/lib/ai/usage";

/**
 * Local development only: totals of AI calls since the server started (counts, no content).
 * In production this route does not exist (404), so usage data is never public.
 */
export async function GET() {
  await connection();
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  return json(200, usageMeter.snapshot());
}
