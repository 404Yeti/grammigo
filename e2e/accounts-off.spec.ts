import { expect, test } from "@playwright/test";

/**
 * Accounts are OFF by default (NEXT_PUBLIC_ACCOUNTS is not "on"). In that state Grammigo has no account surface at all: every account
 * page and endpoint answers 404 as if it did not exist, and nothing needs Supabase. This is the production state until accounts are
 * deliberately enabled.
 */
test.describe("accounts are off by default", () => {
  for (const path of ["/join", "/signin", "/account", "/auth/no-account", "/auth/error", "/api/account/me", "/api/admin/invitations", "/api/auth/callback", "/api/auth/cleanup"]) {
    test(`GET ${path} is 404`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    });
  }

  for (const path of ["/api/auth/join", "/api/auth/signin", "/api/auth/signout", "/api/admin/invitations"]) {
    test(`POST ${path} is 404`, async ({ request }) => {
      const res = await request.post(path, { form: { code: "ABCDEFGHJKM", adult: "on" }, headers: { origin: "http://localhost:3100" }, maxRedirects: 0 });
      expect(res.status()).toBe(404);
    });
  }

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
