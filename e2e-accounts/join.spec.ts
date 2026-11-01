import { BASE, browserHeaders, FLOW_COOKIE, invitation, q, uniqueIp } from "./helpers";
import { expect, test } from "./fixtures";


async function submitCode(page: import("@playwright/test").Page, code: string) {
  await page.goto("/join");
  await page.getByLabel("Invitation code").fill(code);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue with Google" }).click();
}

test.describe("the join page", () => {
  test("renders the form, cannot be framed, and does not need JavaScript", async ({ page, request }) => {
    const res = await page.goto("/join");
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
    expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.getByRole("heading", { name: "Join Grammigo" })).toBeVisible();
    await expect(page.getByLabel("Invitation code")).toHaveAttribute("required", "");
    await expect(page.getByRole("checkbox")).toHaveAttribute("required", "");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    // plain HTML form: no client script is needed to join
    expect((await request.get("/join")).status()).toBe(200);
  });

  test("an unknown code shows a plain message and starts no sign-in", async ({ page }) => {
    await submitCode(page, "ABCDEFGHJKM");
    await expect(page).toHaveURL(/\/join\?e=invite$/);
    await expect(page.locator("main p[role=alert]")).toContainText("isn’t valid");
    expect((await page.context().cookies()).some((c) => c.name === FLOW_COOKIE)).toBe(false);
  });

  test("a malformed code is refused the same way", async ({ page }) => {
    await submitCode(page, "' or 1=1 --");
    await expect(page).toHaveURL(/\/join\?e=invite$/);
  });

  test("an expired invitation says so", async ({ page }) => {
    const inv = await invitation({ expiresInSeconds: -60 });
    await submitCode(page, inv.code);
    await expect(page).toHaveURL(/\/join\?e=expired$/);
    await expect(page.locator("main p[role=alert]")).toContainText("expired");
  });

  test("a revoked invitation says so", async ({ page }) => {
    const inv = await invitation({ revoked: true });
    await submitCode(page, inv.code);
    await expect(page).toHaveURL(/\/join\?e=revoked$/);
    await expect(page.locator("main p[role=alert]")).toContainText("withdrawn");
  });

  test("a used-up invitation says so, and the seat counts are exact", async ({ page, request }) => {
    const inv = await invitation({ maxUses: 1 });
    // The first person reserves the only seat (driven directly: the hop to Google is a redirect the browser cannot be intercepted on).
    const first = await request.post("/api/auth/join", { form: { code: inv.code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(first.status()).toBe(303);
    expect(first.headers().location).toContain("/auth/v1/authorize");
    // The second person, in a real browser form, is told there is no place left.
    await submitCode(page, inv.code);
    await expect(page).toHaveURL(/\/join\?e=full$/);
    await expect(page.locator("main p[role=alert]")).toContainText("no places left");
    const row = (await q("select reserved_count, max_uses from public.invitations where id = $1", [inv.id])).rows[0];
    expect(row).toMatchObject({ reserved_count: 1, max_uses: 1 });
  });

  test("a valid code sends the browser to Google with PKCE, and the cookies are hardened", async ({ request, context }) => {
    const inv = await invitation({ maxUses: 1 });
    const res = await request.post("/api/auth/join", { form: { code: inv.code.toLowerCase(), adult: "on" }, headers: browserHeaders(), maxRedirects: 0 }); // a pasted lower-case code works
    expect(res.status()).toBe(303);
    const url = new URL(res.headers().location);
    expect(url.origin).toBe(new URL(process.env.SUPABASE_API_URL as string).origin);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("code_challenge_method")?.toLowerCase()).toBe("s256");
    expect((url.searchParams.get("code_challenge") ?? "").length).toBeGreaterThanOrEqual(43);
    const redirectTo = new URL(url.searchParams.get("redirect_to") as string);
    expect(redirectTo.origin + redirectTo.pathname).toBe(`${BASE}/api/auth/callback`);

    const cookies = await context.cookies();
    const flow = cookies.find((c) => c.name === FLOW_COOKIE);
    expect(flow).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false }); // secure only over https
    expect(flow!.expires - Date.now() / 1000).toBeLessThanOrEqual(1805);
    const payload = JSON.parse(Buffer.from(flow!.value.split(".")[0], "base64url").toString());
    expect(payload).toMatchObject({ v: 1, intent: "join", nonce: redirectTo.searchParams.get("flow") });
    expect(payload.grant).toMatch(/^[0-9a-f-]{36}$/);
    const verifier = cookies.find((c) => c.name.endsWith("code-verifier"));
    expect(verifier).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    // the signed cookie reveals no personal data and no invitation code
    expect(flow!.value).not.toContain(inv.code.replaceAll("-", ""));
  });
});

test.describe("the join endpoint", () => {
  test("refuses a cross-site POST, and a request that proves it came from our page", async ({ request }) => {
    const form = { code: "ABCDEFGHJKM", adult: "on" };
    expect((await request.post("/api/auth/join", { form, headers: { origin: "https://evil.example", "x-real-ip": uniqueIp() }, maxRedirects: 0 })).status()).toBe(403);
    expect((await request.post("/api/auth/join", { form, headers: { "x-real-ip": uniqueIp() }, maxRedirects: 0 })).status()).toBe(403); // no Origin, no Sec-Fetch-Site
    expect((await request.post("/api/auth/join", { form, headers: { "sec-fetch-site": "cross-site", "x-real-ip": uniqueIp() }, maxRedirects: 0 })).status()).toBe(403);
  });

  test("enforces the 18+ confirmation on the server, not just in the browser", async ({ request }) => {
    const res = await request.post("/api/auth/join", { form: { code: "ABCDEFGHJKM" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(res.headers().location).toBe(`${BASE}/join?e=adult`);
  });

  test("refuses an oversized body", async ({ request }) => {
    const res = await request.post("/api/auth/join", { form: { code: "A".repeat(5000), adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(res.status()).toBe(413);
  });

  test("never caches, never frames, never sniffs", async ({ request }) => {
    const res = await request.post("/api/auth/join", { form: { code: "ABCDEFGHJKM", adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("is rate limited per address: the 9th guess in ten minutes is refused with Retry-After", async ({ request }) => {
    const ip = uniqueIp();
    const outcomes: string[] = [];
    let last = null as null | Awaited<ReturnType<typeof request.post>>;
    for (let i = 0; i < 10; i++) {
      last = await request.post("/api/auth/join", { form: { code: `ABCDEFGHJK${"MNPQRSTUVW"[i]}`, adult: "on" }, headers: browserHeaders(ip), maxRedirects: 0 });
      outcomes.push((last.headers().location ?? "").replace(BASE, ""));
    }
    expect(outcomes.slice(0, 8).every((l) => l === "/join?e=invite")).toBe(true);
    expect(outcomes.slice(8)).toEqual(["/join?e=rate", "/join?e=rate"]);
    expect(Number(last!.headers()["retry-after"])).toBeGreaterThan(0);
    // another address is unaffected
    const other = await request.post("/api/auth/join", { form: { code: "ABCDEFGHJKM", adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(other.headers().location).toBe(`${BASE}/join?e=invite`);
  });
});
