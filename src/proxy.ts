import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loadAuthConfig } from "@/lib/auth/config";
import { hardenCookie } from "@/lib/auth/supabase";
import { fetchWithTimeout } from "@/lib/auth/timeout-fetch";

/**
 * Runs ONLY for the private account paths (see `config.matcher`): the lessons, library, practice and every anonymous page never pass
 * through here, so anonymous use is untouched and pays no cost.
 *
 * Its job is narrow: (1) a visitor with no session cookie at all is redirected before any page renders, and (2) a session that is
 * close to expiry is refreshed and the new cookies are written, because Server Components cannot write cookies.
 *
 * It is NOT the authorisation layer. It makes no access decision a page or API depends on: every private page and endpoint verifies
 * the session itself (`getViewer`) and row-level security checks it again in the database.
 */
export async function proxy(request: NextRequest) {
  const state = loadAuthConfig();
  if (state.state !== "ready") return NextResponse.next();
  const { config } = state;

  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith(config.cookieNames.auth));
  if (!hasSession) {
    if (request.nextUrl.pathname === "/account" || request.nextUrl.pathname.startsWith("/account/")) {
      const redirect = NextResponse.redirect(new URL("/signin?e=session", config.siteUrl), { status: 307, headers: { "Cache-Control": "private, no-store" } });
      // No session: this browser is no longer signed in, so it goes back to the guest's saved progress.
      redirect.cookies.set({ name: config.cookieNames.scope, value: "", path: "/", maxAge: 0, secure: config.secureCookies, sameSite: "lax" });
      return redirect;
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.anonKey, {
    cookieOptions: { name: config.cookieNames.auth },
    global: { fetch: fetchWithTimeout(config.requestTimeoutMs) }, // the proxy must not hang on a Supabase that never answers
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const c of cookies) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of cookies) {
          const o = hardenCookie(c.options, config);
          response.cookies.set({ name: c.name, value: c.value, path: o.path, httpOnly: o.httpOnly, secure: o.secure, sameSite: "lax", maxAge: o.maxAge });
        }
        for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
      },
    },
  });
  try {
    await supabase.auth.getClaims(); // refreshes an expiring session and rewrites the cookies through setAll
  } catch {
    // an unreachable Auth server must not break the page: the page verifies the session itself and fails closed
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  matcher: ["/account/:path*", "/api/account/:path*", "/api/admin/:path*"],
};
