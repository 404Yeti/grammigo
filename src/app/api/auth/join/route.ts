import type { NextRequest } from "next/server";
import { handleJoin } from "@/lib/auth/handlers";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const form = await req.formData().catch(() => null);
  const code = form?.get("code");
  const result = await handleJoin(rt, { headers: req.headers, code: typeof code === "string" ? code : "", adult: form?.get("adult") === "on" });
  return toResponse(result, gate.config, cookies);
}
