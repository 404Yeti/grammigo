/**
 * Cross-site request protection for every state-changing account route (defence in depth beside SameSite=Lax cookies).
 * A browser always sends Origin on a cross-origin POST; we require it to be OUR origin. If Origin is absent the browser must say
 * Sec-Fetch-Site: same-origin. A request that proves neither (a script, or an old client) is refused.
 */
export function isTrustedOrigin(headers: Headers, siteUrl: URL): boolean {
  const origin = headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === siteUrl.origin;
    } catch {
      return false;
    }
  }
  return headers.get("sec-fetch-site") === "same-origin";
}
