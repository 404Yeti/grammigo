import type { NextRequest } from "next/server";
import { lifecycleDeps, lifecycleResponse } from "@/lib/auth/lifecycle-http";
import { handleDelete } from "@/lib/auth/lifecycle";

export async function POST(req: NextRequest) {
  const r = await lifecycleDeps(req);
  if ("response" in r) return r.response;
  const body = await req.json().catch(() => null);
  return lifecycleResponse(await handleDelete(r.deps, body), r.cookies);
}
