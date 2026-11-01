import type { NextRequest } from "next/server";
import { authGate, privateJson, runtimeFor, withCookies } from "@/lib/auth/http";
import { handleProfileGet, handleProfilePatch, type ProfileDeps } from "@/lib/auth/profile-api";
import { getViewer } from "@/lib/auth/viewer";

// The learner's own profile. Uses ONLY the learner's own session client (rt.session): the service role is deliberately not touched here.
async function deps(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return { response: gate.response } as const;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const d: ProfileDeps = { config: gate.config, viewer: await getViewer(rt.session), client: rt.session, limiter: rt.db.limiter, headers: req.headers };
  return { d, cookies } as const;
}

export async function GET(req: NextRequest) {
  const r = await deps(req);
  if ("response" in r) return r.response;
  const out = await handleProfileGet(r.d);
  return withCookies(privateJson(out.status, out.body), r.cookies);
}

export async function PATCH(req: NextRequest) {
  const r = await deps(req);
  if ("response" in r) return r.response;
  const body = await req.json().catch(() => null);
  const out = await handleProfilePatch(r.d, body);
  return withCookies(privateJson(out.status, out.body, out.retryAfter ? { "Retry-After": String(out.retryAfter) } : {}), r.cookies);
}
