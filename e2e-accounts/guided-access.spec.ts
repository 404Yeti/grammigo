import { expect, test } from "./fixtures";
import { createAccount, sessionCookies } from "./helpers";

const path = "/practice/present-perfect-vs-past-simple/guided";
test("production preview flag never grants a guest access", async ({ page, request }) => {
  const access = await request.get("/api/guided/access");
  expect(await access.json()).toEqual({ allowed: false });
  expect(access.headers()["cache-control"]).toContain("no-store");
  await page.goto(path);
  await expect(page).toHaveURL(/\/signin\?e=session$/);
});
test("ordinary learner cannot see the preview card or open the direct route", async ({ context, page, request }) => {
  const learner = await createAccount({ name: "Preview learner", learner: true });
  await context.addCookies(sessionCookies(learner));
  expect(await (await request.get("/api/guided/access")).json()).toEqual({ allowed: false });
  const response = await page.goto(path);
  // With Cache Components the outer shell may already be streamed with HTTP 200.
  // Verify the denial actually rendered and that no private activity rendered.
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  await expect(page.getByTestId("guided-screen")).toHaveCount(0);
  await page.goto("/practice/present-perfect-vs-past-simple");
  await expect(page.getByTestId("guided-entry")).toHaveCount(0);
});
test("verified owner retains private preview access", async ({ context, page, request }) => {
  const owner = await createAccount({ name: "Preview owner", admin: true });
  await context.addCookies(sessionCookies(owner));
  const access = await request.get("/api/guided/access");
  expect(await access.json()).toEqual({ allowed: true });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByTestId("guided-screen")).toBeVisible();
  await page.goto("/practice/present-perfect-vs-past-simple");
  await expect(page.getByTestId("guided-entry")).toBeVisible();
});
