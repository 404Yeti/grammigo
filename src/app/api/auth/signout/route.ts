import type { NextRequest } from "next/server";
import { handleSignOut } from "@/lib/auth/handlers";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  return toResponse(await handleSignOut(rt, { headers: req.headers }), gate.config, cookies);
}
