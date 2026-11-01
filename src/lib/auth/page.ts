import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { loadAuthConfig, type AuthConfig } from "./config";
import { CookieSession } from "./cookie-session";
import { createSessionClient } from "./supabase";
import { getViewer, type Viewer } from "./viewer";

/**
 * The gate for every private PAGE. Nothing below it renders for anyone who is not an active learner.
 *  - accounts off or mis-configured: 404
 *  - no valid session: redirect to sign-in
 *  - a session without an active profile (an uninvited Google identity, a suspended account): redirect to "No account yet"
 *  - `admin: true` and not an owner: 404, so the owner pages do not even reveal that they exist
 * The session is verified with the Auth server, and the profile is read as the learner, so row-level security agrees.
 */
export async function requireLearner(opts: { admin?: boolean } = {}): Promise<{ viewer: Extract<Viewer, { kind: "learner" }>; client: SupabaseClient; config: AuthConfig }> {
  await connection(); // decide per request; the session library reads the clock
  const state = loadAuthConfig();
  if (state.state !== "ready") notFound();
  const jar = new CookieSession((await cookies()).getAll());
  const client = createSessionClient(state.config, jar);
  const viewer = await getViewer(client);
  if (viewer.kind === "anonymous") redirect("/signin?e=session");
  if (viewer.kind === "no_profile") redirect("/auth/no-account");
  if (opts.admin && !viewer.isAdmin) notFound();
  return { viewer, client, config: state.config };
}
