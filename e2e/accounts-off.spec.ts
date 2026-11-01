import { expect, test } from "@playwright/test";

/**
 * Accounts are OFF by default (NEXT_PUBLIC_ACCOUNTS is not "on"). In that state Grammigo has no account surface at all: every account
 * page and endpoint answers 404 as if it did not exist, and nothing needs Supabase. This is the production state until accounts are
 * deliberately enabled.
 */
test.describe("accounts are off by default", () => {
  for (const path of ["/join", "/signin", "/account", "/account/profile", "/auth/no-account", "/auth/error", "/api/account/me", "/api/admin/invitations", "/api/auth/callback", "/api/auth/cleanup", "/api/sync/state", "/api/sync/documents/lessons_v2"]) {
    test(`GET ${path} is 404`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    });
  }

  for (const path of ["/api/auth/join", "/api/auth/signin", "/api/auth/signout", "/api/admin/invitations", "/api/sync/consent"]) {
    test(`POST ${path} is 404`, async ({ request }) => {
      const res = await request.post(path, { form: { code: "ABCDEFGHJKM", adult: "on" }, headers: { origin: "http://localhost:3100" }, maxRedirects: 0 });
      expect(res.status()).toBe(404);
    });
  }

  test("saving progress is not even reachable: PUT /api/sync/documents is 404", async ({ request }) => {
    const res = await request.put("/api/sync/documents/lessons_v2", { data: { expectedRevision: 0, body: {} }, headers: { origin: "http://localhost:3100" }, maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("a lesson makes no request to any account or sync endpoint", async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith("/api/sync") || p.startsWith("/api/account") || p.startsWith("/api/auth") || p.startsWith("/api/admin")) hits.push(p);
    });
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Grammar library" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(hits).toEqual([]);
  });

  test("the shared page shell shows no sign-in link at all", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Grammar library" })).toBeVisible();
    await expect(page.getByTestId("account-entry")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /sign in|account/i })).toHaveCount(0);
  });

  test("the learning app is unaffected and sets no cookies", async ({ request }) => {
    for (const path of ["/", "/library", "/onboarding", "/privacy"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["set-cookie"], path).toBeUndefined();
    }
  });
});
