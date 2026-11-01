import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPut } from "@/lib/auth/sync-api";
import { syncDeps, syncResponse } from "@/lib/auth/sync-http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sync/documents/[key]">) {
  const r = await syncDeps(req);
  if ("response" in r) return r.response;
  const { key } = await ctx.params;
  return syncResponse(await handleSyncGet(r.deps, key), r.cookies);
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/sync/documents/[key]">) {
  const r = await syncDeps(req);
  if ("response" in r) return r.response;
  const { key } = await ctx.params;
  const text = await req.text();
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // an unparseable body fails the envelope check below
  }
  return syncResponse(await handleSyncPut(r.deps, key, raw, new TextEncoder().encode(text).length), r.cookies);
}
