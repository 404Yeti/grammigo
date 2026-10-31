/**
 * Where to send a learner after sign-in. Only same-site paths in this allowlist are honoured, so a crafted `next` can never become
 * an open redirect. Anything else falls back to the account page.
 */
const ALLOWED_PREFIXES = ["/account"];

export function safeNext(raw: string | null | undefined, fallback = "/account"): string {
  if (!raw || raw.length > 200) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "https://placeholder.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://placeholder.invalid") return fallback;
  const allowed = ALLOWED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  return allowed ? url.pathname + url.search : fallback;
}
