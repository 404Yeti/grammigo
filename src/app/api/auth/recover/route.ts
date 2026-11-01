import type { NextRequest } from "next/server";
import { callbackAllowed } from "@/lib/auth/handlers";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handleRecover, handleRecoverToken } from "@/lib/auth/password";

// POST: the button on /auth/reset (the link in the reset email). Works in any browser or device. Rate limited like the sign-in callback.
export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const limit = await callbackAllowed(rt, req.headers);
  if (!limit.allowed) return toResponse({ status: 429, retryAfter: limit.retryAfter }, gate.config, cookies);
  const form = await req.formData().catch(() => null);
  const token = form?.get("token_hash");
  return toResponse(await handleRecoverToken(rt, { headers: req.headers, tokenHash: typeof token === "string" ? token : "" }), gate.config, cookies);
}

// GET: only the older same-browser link (PKCE), for a project whose reset email still has the default link.
export async function GET(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const limit = await callbackAllowed(rt, req.headers);
  if (!limit.allowed) return toResponse({ status: 429, retryAfter: limit.retryAfter }, gate.config, cookies);
  return toResponse(await handleRecover(rt, { code: req.nextUrl.searchParams.get("code") }), gate.config, cookies);
}
