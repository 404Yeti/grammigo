import type { NextRequest } from "next/server";
import { handleCallback } from "@/lib/auth/callback";
import { callbackAllowed } from "@/lib/auth/handlers";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";

// GET, because the browser arrives here by redirect from Google. It is safe to be a GET: it can only ever sign in the browser that
// holds the matching signed flow cookie and PKCE verifier, and a forged request without them is refused before any exchange.
export async function GET(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);

  const limit = await callbackAllowed(rt, req.headers);
  if (!limit.allowed) return toResponse({ status: 429, retryAfter: limit.retryAfter }, gate.config, cookies);

  const p = req.nextUrl.searchParams;
  const result = await handleCallback(rt, { code: p.get("code"), providerError: p.get("error"), flowParam: p.get("flow") });
  return toResponse({ status: 303, location: result.redirect }, gate.config, cookies);
}
