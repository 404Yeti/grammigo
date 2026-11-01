import type { NextRequest } from "next/server";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handleRegister } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const form = await req.formData().catch(() => null);
  const text = (k: string) => (typeof form?.get(k) === "string" ? (form?.get(k) as string) : "");
  const result = await handleRegister(rt, { headers: req.headers, code: text("code"), email: text("email"), password: text("password"), adult: form?.get("adult") === "on" });
  return toResponse(result, gate.config, cookies);
}
