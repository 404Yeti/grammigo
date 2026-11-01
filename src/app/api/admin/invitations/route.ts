import type { NextRequest } from "next/server";
import { createInvitation, listInvitations, type AdminDeps } from "@/lib/auth/admin";
import { authGate, privateJson, runtimeFor, withCookies } from "@/lib/auth/http";
import { getViewer } from "@/lib/auth/viewer";

async function deps(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return { response: gate.response } as const;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const d: AdminDeps = { config: gate.config, viewer: await getViewer(rt.session), service: rt.service, limiter: rt.db.limiter, headers: req.headers, now: () => Date.now() };
  return { d, cookies } as const;
}

export async function GET(req: NextRequest) {
  const r = await deps(req);
  if ("response" in r) return r.response;
  const out = await listInvitations(r.d);
  return withCookies(privateJson(out.status, out.body), r.cookies);
}

export async function POST(req: NextRequest) {
  const r = await deps(req);
  if ("response" in r) return r.response;
  const body = await req.json().catch(() => null);
  const out = await createInvitation(r.d, body);
  return withCookies(privateJson(out.status, out.body, out.retryAfter ? { "Retry-After": String(out.retryAfter) } : {}), r.cookies);
}
