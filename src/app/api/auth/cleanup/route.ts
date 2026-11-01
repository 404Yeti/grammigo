import type { NextRequest } from "next/server";
import { cronAuthorised, runCleanup } from "@/lib/auth/cleanup";
import { createServiceClient } from "@/lib/auth/supabase";
import { authGate, privateJson } from "@/lib/auth/http";

// Called by a scheduler with `Authorization: Bearer <CRON_SECRET>`. Not callable by a browser session: the secret is the only way in.
export async function GET(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  if (!cronAuthorised(req.headers.get("authorization"), gate.config.cronSecret)) return privateJson(401, { error: "unauthorised" });
  const report = await runCleanup(createServiceClient(gate.config));
  return privateJson(report.failed.length ? 500 : 200, report);
}
