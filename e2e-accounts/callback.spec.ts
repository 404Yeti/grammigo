import { BASE, browserHeaders, COOKIE, FLOW_COOKIE, invitation, q, uniqueIp } from "./helpers";
import { expect, test } from "./fixtures";

const ip = () => ({ "x-real-ip": uniqueIp() });
const where = (res: { headers(): Record<string, string> }) => (res.headers().location ?? "").replace(BASE, "");

test.describe("the sign-in callback refuses anything that is not our own flow", () => {
  test("a link opened in a browser that never started the sign-in (no flow cookie) is refused before anything is exchanged", async ({ request }) => {
    const res = await request.get("/api/auth/callback?code=abc&flow=zzzzzzzzzzzzzzzzzzzzzzzz", { headers: ip(), maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(where(res)).toBe("/auth/error?r=state");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("the error page uses fixed wording and echoes nothing from the URL", async ({ page }) => {
    await page.goto("/auth/error?r=<script>alert(1)</script>");
    await expect(page.getByRole("alert")).toContainText("Something went wrong on our side");
    await expect(page.locator("body")).not.toContainText("<script>");
    await page.goto("/auth/error?r=state");
    await expect(page.getByRole("alert")).toContainText("expired or was opened somewhere else");
  });

  test("pressing Cancel at Google is a calm cancel", async ({ page }) => {
    await page.goto("/api/auth/callback?error=access_denied&error_description=anything");
    await expect(page).toHaveURL(/\/auth\/error\?r=cancelled$/);
    await expect(page.getByRole("alert")).toContainText("cancelled");
  });

  test("a FORGED flow cookie is refused", async ({ request, context }) => {
    await context.addCookies([{ name: FLOW_COOKIE, value: `${Buffer.from("{}").toString("base64url")}.${"A".repeat(43)}`, url: BASE }]);
    const res = await request.get("/api/auth/callback?code=abc&flow=zzzzzzzzzzzzzzzzzzzzzzzz", { headers: ip(), maxRedirects: 0 });
    expect(where(res)).toBe("/auth/error?r=state");
  });

  test("a genuine flow cookie with the WRONG nonce in the URL is refused (callback link replayed elsewhere)", async ({ request, context }) => {
    const inv = await invitation();
    const start = await request.post("/api/auth/join", { form: { code: inv.code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(start.status()).toBe(303);
    expect((await context.cookies()).some((c) => c.name === FLOW_COOKIE)).toBe(true);
    const res = await request.get("/api/auth/callback?code=abc&flow=zzzzzzzzzzzzzzzzzzzzzzzz", { headers: ip(), maxRedirects: 0 });
    expect(where(res)).toBe("/auth/error?r=state");
    expect((await context.cookies()).some((c) => c.name === FLOW_COOKIE)).toBe(false); // single use: gone
  });

  test("a genuine flow with a code Google never issued is rejected by the Auth server (PKCE), leaves no session, and frees the seat", async ({ request, context }) => {
    const inv = await invitation({ maxUses: 1 });
    const start = await request.post("/api/auth/join", { form: { code: inv.code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    const nonce = new URL(new URL(start.headers().location).searchParams.get("redirect_to") as string).searchParams.get("flow");
    expect((await q("select reserved_count from public.invitations where id = $1", [inv.id])).rows[0].reserved_count).toBe(1);

    const res = await request.get(`/api/auth/callback?code=not-a-real-code&flow=${nonce}`, { headers: ip(), maxRedirects: 0 });
    expect(where(res)).toBe("/auth/error?r=exchange");
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).not.toContain(COOKIE);
    expect(names).not.toContain(FLOW_COOKIE);
    expect((await q("select reserved_count from public.invitations where id = $1", [inv.id])).rows[0].reserved_count).toBe(0);
    expect((await q("select count(*)::int as n from public.profiles where joined_via_invitation = $1", [inv.id])).rows[0].n).toBe(0);
  });

  test("the callback itself is rate limited", async ({ request }) => {
    const same = ip();
    let refused = 0;
    for (let i = 0; i < 33; i++) {
      const r = await request.get("/api/auth/callback?code=abc&flow=zzzzzzzzzzzzzzzzzzzzzzzz", { headers: same, maxRedirects: 0 });
      if (r.status() === 429) {
        refused++;
        expect(Number(r.headers()["retry-after"])).toBeGreaterThan(0);
      }
    }
    expect(refused).toBe(3);
  });
});

test.describe("the sign-in page", () => {
  test("starts a Google sign-in with no invitation, and points newcomers to the invitation page", async ({ page, context }) => {
    let authorize: URL | null = null;
    await page.route(`${process.env.SUPABASE_API_URL}/auth/v1/authorize**`, (route) => {
      authorize = new URL(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Google</h1>" });
    });
    await page.goto("/signin");
    await expect(page.getByRole("link", { name: /Join with an invitation code/ })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
    expect((authorize as unknown as URL).searchParams.get("provider")).toBe("google");
    const flow = (await context.cookies()).find((c) => c.name === FLOW_COOKIE)!;
    const payload = JSON.parse(Buffer.from(flow.value.split(".")[0], "base64url").toString());
    expect(payload.intent).toBe("signin");
    expect(payload.grant).toBeUndefined();
  });

  test("the no-account page explains plainly, with a way out", async ({ page }) => {
    await page.goto("/auth/no-account");
    await expect(page.getByRole("heading", { name: "No account yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Keep practising without an account" })).toBeVisible();
  });
});
