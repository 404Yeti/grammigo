import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The accounts browser tests build with the accounts switch ON into their own folder, so they never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // Account pages and endpoints are per-person: never cached by a browser, a CDN or a proxy, never framed, never sniffed. The
    // public learning pages are deliberately NOT listed here, so anonymous use keeps its existing caching.
    const privateHeaders = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    // The sign-in forms are public (and may be cached) but must never be framed: a framed sign-in form is a clickjacking target.
    const frameGuard = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "same-origin" },
    ];
    return [
      { source: "/account/:path*", headers: privateHeaders },
      { source: "/auth/:path*", headers: privateHeaders },
      { source: "/api/auth/:path*", headers: privateHeaders },
      { source: "/api/account/:path*", headers: privateHeaders },
      { source: "/api/admin/:path*", headers: privateHeaders },
      { source: "/join", headers: frameGuard },
      { source: "/signin", headers: frameGuard },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
