import type { NextRequest } from "next/server";
import { handleSyncState } from "@/lib/auth/sync-api";
import { syncDeps, syncResponse } from "@/lib/auth/sync-http";

export async function GET(req: NextRequest) {
  const r = await syncDeps(req);
  if ("response" in r) return r.response;
  return syncResponse(await handleSyncState(r.deps), r.cookies);
}
