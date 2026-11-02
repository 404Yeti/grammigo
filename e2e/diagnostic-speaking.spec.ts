import { expect, test, type Page } from "@playwright/test";
import { emptyState } from "../src/lib/storage/schema";
import { createRun } from "../src/features/diagnostic/engine";

test.skip(process.env.E2E_DIAGNOSTIC_SPEAKING !== "1", "Requires optional speaking build");
async function results(page: Page, available = false) {
  const state = emptyState();
  state.onboarding = { ...state.onboarding, status: "in_progress", step: "profile", runId: "sample", startedAt: 1 };
  state.diagnosticRuns = [{ ...createRun("sample", [], 1), finishedAt: 2 }];
  await page.addInitScript(s => { if (!localStorage.getItem("grammigo:v2")) localStorage.setItem("grammigo:v2", JSON.stringify(s)); }, state);
  await page.route("**/api/ai/status", r => r.fulfill({ json: { available } }));
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Try optional speaking" }).click();
}
test("optional sample can be skipped with AI unavailable, preserving results and lesson access", async ({ page }) => {
  await results(page);
  await page.getByRole("button", { name: "Skip speaking" }).click();
  await expect(page.getByTestId("onboarding-profile")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "See my first lesson" }).click();
  await expect(page.getByTestId("onboarding-recommendation")).toBeVisible();
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).diagnosticRuns[0]);
  expect(run.responses).toEqual([]);
  expect(run.optionalSpeaking.status).toBe("skipped");
});
test("typed fallback supports correction and saves only after Continue", async ({ page }, info) => {
  await results(page);
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your answer").fill("My favorite place are the park.");
  await page.getByRole("button", { name: "Check my sentence" }).click();
  await expect(page.getByTestId("optional-diagnostic-speaking")).toContainText("singular");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).diagnosticRuns[0].optionalSpeaking)).toBeUndefined();
  await page.getByRole("button", { name: "Try my sentence again" }).click();
  await page.getByLabel("Your answer").fill("My favorite place is the park.");
  await page.getByRole("button", { name: "Check my sentence" }).click();
  await page.screenshot({ path: info.outputPath("diagnostic-speaking.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue to my results" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Review my optional speaking sample" }).click();
  await expect(page.getByLabel("Your answer")).toHaveValue("My favorite place is the park.");
});
test("recorded transcript stays unsaved until reviewed, and skip cancels capture", async ({ page }) => {
  await results(page, true);
  await page.route("**/api/ai/transcribe", r => r.fulfill({ json: { status: "ok", text: "My favorite place is the park." } }));
  await page.getByRole("button", { name: "Record an answer" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByLabel("What we heard")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("grammigo:v2"))).not.toContain("My favorite place");
  await page.getByRole("button", { name: "Use this transcript" }).click();
  await page.getByRole("button", { name: "Check my sentence" }).click();
  await page.getByRole("button", { name: "Continue to my results" }).click();
  await page.getByRole("button", { name: "Review my optional speaking sample" }).click();
  await page.getByRole("button", { name: "Skip speaking" }).click();
  await expect(page.getByTestId("onboarding-profile")).toBeVisible();
});
