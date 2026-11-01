import type { NextRequest } from "next/server";
import { lifecycleDeps, lifecycleResponse } from "@/lib/auth/lifecycle-http";
import { handleExport } from "@/lib/auth/lifecycle";

// POST, not GET: it records that an export happened, and a state-changing request must pass the same-origin check.
export async function POST(req: NextRequest) {
  const r = await lifecycleDeps(req);
  if ("response" in r) return r.response;
  return lifecycleResponse(await handleExport(r.deps), r.cookies);
}
