import type { NextRequest } from "next/server";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handleForgot } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const form = await req.formData().catch(() => null);
  const email = form?.get("email");
  return toResponse(await handleForgot(rt, { headers: req.headers, email: typeof email === "string" ? email : "" }), gate.config, cookies);
}
