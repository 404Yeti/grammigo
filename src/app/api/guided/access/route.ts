import { connection, type NextRequest } from "next/server";
import { guidedOwnerPreviewRequested, guidedPublicPreview } from "@/features/guided/visibility";
import { authGate, privateJson, runtimeFor, withCookies } from "@/lib/auth/http";
import { getViewer } from "@/lib/auth/viewer";

export async function GET(req: NextRequest) {
  await connection();
  if (guidedPublicPreview()) return privateJson(200, { allowed: true });
  if (!guidedOwnerPreviewRequested()) return privateJson(200, { allowed: false });
  const gate = await authGate();
  if (!gate.ok) return privateJson(200, { allowed: false });
  try {
    const { rt, cookies } = runtimeFor(gate.config, req);
    const viewer = await getViewer(rt.session);
    return withCookies(privateJson(200, { allowed: viewer.kind === "learner" && viewer.isAdmin }), cookies);
  } catch {
    return privateJson(200, { allowed: false });
  }
}
