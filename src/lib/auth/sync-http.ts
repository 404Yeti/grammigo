import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { authGate, privateJson, runtimeFor, withCookies } from "./http";
import type { SyncDeps, SyncResult } from "./sync-api";
import { getViewer } from "./viewer";

/** Shared plumbing for the three sync routes. Each route decides nothing itself: it builds the deps and returns the handler's answer. */
export async function syncDeps(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return { response: gate.response } as const;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const deps: SyncDeps = { config: gate.config, viewer: await getViewer(rt.session), client: rt.session, service: rt.service, limiter: rt.db.limiter, headers: req.headers };
  return { deps, cookies } as const;
}

export function syncResponse(out: SyncResult, cookies: Parameters<typeof withCookies>[1]): NextResponse {
  const extra: Record<string, string> = {};
  if (out.retryAfter) extra["Retry-After"] = String(out.retryAfter);
  if (out.dbMs !== undefined) extra["Server-Timing"] = `db;dur=${Math.round(out.dbMs * 10) / 10}`; // how long the database took, for measuring
  return withCookies(privateJson(out.status, out.body, extra), cookies);
}
