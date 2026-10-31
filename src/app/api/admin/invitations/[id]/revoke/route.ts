import type { NextRequest } from "next/server";
import { revokeInvitation, type AdminDeps } from "@/lib/auth/admin";
import { authGate, privateJson, runtimeFor, withCookies } from "@/lib/auth/http";
import { getViewer } from "@/lib/auth/viewer";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/invitations/[id]/revoke">) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const d: AdminDeps = { config: gate.config, viewer: await getViewer(rt.session), service: rt.service, limiter: rt.db.limiter, headers: req.headers, now: () => Date.now() };
  const { id } = await ctx.params;
  const out = await revokeInvitation(d, id);
  return withCookies(privateJson(out.status, out.body, out.retryAfter ? { "Retry-After": String(out.retryAfter) } : {}), cookies);
}
