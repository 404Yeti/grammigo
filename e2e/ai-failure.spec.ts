import { expect, test, type Page } from "@playwright/test";
import { playWholeLesson, seedReturningLearner, startFromHome } from "./helpers";

/**
 * AI is reported as available, but every AI call then fails in a different way. The app must stay
 * fully usable: typed goals fall back to offline matching, lessons finish, nothing is marked wrong
 * because AI failed, and no raw error is shown. Network is mocked, so no OpenAI calls are made and
 * this runs the same against a local build or the live site.
 */
const FAILURES: [string, { status: number; body: unknown } | "abort"][] = [
  ["timeout (504)", { status: 504, body: { error: "timeout" } }],
  ["unavailable (503)", { status: 503, body: { error: "unavailable", reason: "limiter" } }],
  ["rate limited (429)", { status: 429, body: { error: "rate_limited" } }],
  ["bad model output (502)", { status: 502, body: { error: "invalid_response" } }],
  ["network failure", "abort"],
];

async function breakAi(page: Page, failure: (typeof FAILURES)[number][1]) {
  await page.route("**/api/ai/status", (r) =>
    r.fulfill({ json: { available: true, features: { goals: true, transcribe: true, writing: true } } }),
  );
  await page.route(/\/api\/ai\/(goals|writing-feedback|transcribe)$/, (r) =>
    failure === "abort" ? r.abort() : r.fulfill({ status: failure.status, json: failure.body }),
  );
}

for (const [name, failure] of FAILURES) {
  test.describe(`AI call fails: ${name}`, () => {
    test("typed goals still work (offline matching) and the quick check starts", async ({ page }) => {
      await breakAi(page, failure);
      await page.goto("/onboarding");
      await page.getByRole("button", { name: "Type it" }).click();
      await page.getByLabel("Tell Migo in your own words").fill("I always mix up past simple and present perfect");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByTestId("goal-chips")).toContainText(/Present perfect|Past simple/);
      await page.getByRole("button", { name: "Start the quick check" }).click();
      await expect(page.getByText("Quick check · question 1")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(/invalid_response|rate_limited|TypeError|Unhandled/i);
    });

    test("a lesson with a writing question can still be finished", async ({ page }) => {
      await breakAi(page, failure);
      await seedReturningLearner(page);
      await startFromHome(page, "a1-present-simple");
      await playWholeLesson(page, "a1-present-simple");
      await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(/invalid_response|rate_limited|TypeError|Unhandled/i);
    });
  });
}
