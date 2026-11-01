import type { NextRequest } from "next/server";
import { authGate, privateJson, runtimeFor, withCookies } from "@/lib/auth/http";
import { getViewer, statusFor } from "@/lib/auth/viewer";

// The first piece of account functionality behind the learner gate. 401 = no session, 403 = a session without an active learner
// profile (an uninvited Google identity, or a suspended account: indistinguishable on purpose), 200 = a learner.
export async function GET(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { rt, cookies } = runtimeFor(gate.config, req);
  const viewer = await getViewer(rt.session);
  const status = statusFor(viewer);
  const body = viewer.kind === "learner" ? { displayName: viewer.displayName } : { error: status === 401 ? "unauthenticated" : status === 503 ? "unavailable" : "forbidden" };
  return withCookies(privateJson(status, body), cookies);
}
