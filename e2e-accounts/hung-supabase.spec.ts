import type { Page } from "@playwright/test";
import { expectQuestion, LESSON, playWholeLesson } from "../e2e/helpers";
import { createAccount, sessionCookies } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * A Supabase that ACCEPTS connections and never answers (a TCP black hole started by global setup), which is harder than one that refuses:
 * without a timeout every account call would wait. The app abandons each call after AUTH_REQUEST_TIMEOUT_MS (2 s on this server).
 * Lessons make no Supabase call at all, so they must not notice.
 */
const HANG = `http://localhost:${process.env.E2E_HANG_PORT ?? 3103}`;
test.use({ baseURL: HANG });

async function finishLesson(page: Page) {
  await page.goto(`/practice/${LESSON}`);
  await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
  await expectQuestion(page, 1);
  await playWholeLesson(page, LESSON);
  await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
}

test.describe("Supabase hangs (never answers)", () => {
  test("the account routes give up and say 'try later' within a few seconds, never 'sign in again', and lessons and the library are unaffected", async ({ context, page, request }) => {
    test.setTimeout(150_000);
    const ana = await createAccount({ name: "Hung Ana", learner: true });
    await context.addCookies([...sessionCookies(ana).map((c) => ({ ...c, url: HANG })), { name: "gm-scope", value: ana.id, url: HANG }]);

    for (const [name, call] of [
      ["me", () => request.get("/api/account/me")],
      ["sync state", () => request.get("/api/sync/state")],
      ["export", () => request.post("/api/account/export", { headers: { origin: HANG } })],
      ["delete", () => request.post("/api/account/delete", { data: JSON.stringify({ confirm: "delete my account" }), headers: { origin: HANG, "content-type": "application/json" } })],
    ] as const) {
      const t0 = Date.now();
      const res = await call();
      const ms = Date.now() - t0;
      expect(res.status(), name).toBe(503);
      expect(res.headers()["cache-control"], name).toContain("no-store");
      expect(ms, `${name} took ${ms} ms`).toBeLessThan(9_000); // 2 s timeout, a few calls in series, generous margin
    }

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const t0 = Date.now();
    await finishLesson(page);
    const took = Date.now() - t0;
    console.log("E2E_HANG_LESSON_MS " + took);
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
    expect(took).toBeLessThan(60_000);
    expect(errors).toEqual([]);
    await page.goto("/library");
    await expect(page.getByTestId("lesson-card").and(page.locator(`[data-skill="${LESSON}"]`)).getByTestId("completion")).toContainText("Completed 1×");
  });

  test("an account page does not send anyone to sign in when it cannot reach Supabase", async ({ context, page }) => {
    const ana = await createAccount({ name: "Hung Page Ana", learner: true });
    await context.addCookies([...sessionCookies(ana).map((c) => ({ ...c, url: HANG })), { name: "gm-scope", value: ana.id, url: HANG }]);
    const t0 = Date.now();
    await page.goto("/account", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    expect(page.url()).not.toContain("/signin");
    expect(Date.now() - t0).toBeLessThan(25_000);
  });
});
