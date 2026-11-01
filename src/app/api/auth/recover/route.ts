import type { NextRequest } from "next/server";
import { callbackAllowed } from "@/lib/auth/handlers";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handleRecover } from "@/lib/auth/password";

// GET, because the browser arrives here from the link in the reset email. It only works in the browser that asked for the reset (the PKCE
// verifier lives there), only for an email-only account that has a profile, and it is rate limited like the sign-in callback.
export async function GET(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const limit = await callbackAllowed(rt, req.headers);
  if (!limit.allowed) return toResponse({ status: 429, retryAfter: limit.retryAfter }, gate.config, cookies);
  return toResponse(await handleRecover(rt, { code: req.nextUrl.searchParams.get("code") }), gate.config, cookies);
}
