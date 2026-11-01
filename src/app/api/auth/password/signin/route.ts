import type { NextRequest } from "next/server";
import { authGate, runtimeFor, toResponse } from "@/lib/auth/http";
import { handlePasswordSignIn } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const form = await req.formData().catch(() => null);
  const text = (k: string) => (typeof form?.get(k) === "string" ? (form?.get(k) as string) : "");
  // Confirming oneself again before something irreversible: read WHO is signed in before the password sign-in can replace that session.
  let reauthUserId: string | undefined;
  if (text("reauth") === "1") {
    const current = await rt.auth.getUser().catch(() => null);
    if (!current) return toResponse({ status: 303, location: "/signin?e=session" }, gate.config, cookies);
    reauthUserId = current.id;
  }
  const result = await handlePasswordSignIn(rt, { headers: req.headers, email: text("email"), password: text("password"), reauthUserId });
  return toResponse(result, gate.config, cookies);
}
