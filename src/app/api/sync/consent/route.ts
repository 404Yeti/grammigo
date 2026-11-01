import type { NextRequest } from "next/server";
import { handleSyncConsent } from "@/lib/auth/sync-api";
import { syncDeps, syncResponse } from "@/lib/auth/sync-http";

export async function POST(req: NextRequest) {
  const r = await syncDeps(req);
  if ("response" in r) return r.response;
  const body = await req.json().catch(() => null);
  return syncResponse(await handleSyncConsent(r.deps, body), r.cookies);
}
