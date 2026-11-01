import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { authGate, privateJson, runtimeFor, withCookies } from "./http";
import { readSignedInAt, type LifecycleDeps, type LifecycleResult } from "./lifecycle";
import { getViewer } from "./viewer";

/** Shared plumbing for the export and delete routes. The routes decide nothing themselves: they build the deps and return the handler's answer. */
export async function lifecycleDeps(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return { response: gate.response } as const;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const viewer = await getViewer(rt.session);
  const deps: LifecycleDeps = {
    config: gate.config,
    viewer,
    client: rt.session,
    service: rt.service,
    limiter: rt.db.limiter,
    headers: req.headers,
    signedInAt: viewer.kind === "learner" ? await readSignedInAt(rt.session) : null,
    now: () => Date.now(),
    log: rt.log,
    endSession: () => rt.jar.clearAuthCookies(),
  };
  return { deps, cookies } as const;
}

export function lifecycleResponse(out: LifecycleResult, cookies: Parameters<typeof withCookies>[1]): NextResponse {
  const extra: Record<string, string> = {};
  if (out.retryAfter) extra["Retry-After"] = String(out.retryAfter);
  if (out.download) extra["Content-Disposition"] = `attachment; filename="${out.download.filename}"`;
  return withCookies(privateJson(out.status, out.body, extra), cookies);
}
