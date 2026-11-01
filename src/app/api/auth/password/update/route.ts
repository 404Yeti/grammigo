import type { NextRequest } from "next/server";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handleNewPassword } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const form = await req.formData().catch(() => null);
  const text = (k: string) => (typeof form?.get(k) === "string" ? (form?.get(k) as string) : "");
  return toResponse(await handleNewPassword(rt, { headers: req.headers, password: text("password"), confirm: text("confirm") }), gate.config, cookies);
}
