import { expect, test, type Page } from "@playwright/test";
import { answerQuizQuestion } from "./helpers";

/**
 * Regression for the reported bug: a learner who says "articles" must be sent to Articles first,
 * however the quick check goes. Articles has no prerequisites, so nothing legitimately blocks it.
 */
async function sayArticlesThenTakeQuickCheck(page: Page, correct: (questionNumber: number) => boolean) {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Type it" }).click();
  await page.getByLabel("Tell Migo in your own words").fill("I want to improve articles, a an the");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("goal-chips")).toContainText(/Articles|a \/ an \/ the/);
  await page.getByRole("button", { name: "Start the quick check" }).click();
  for (let i = 0; i < 12 && !(await page.getByTestId("onboarding-profile").isVisible()); i++) {
    await expect(page.getByText(`Quick check · question ${i + 1}`)).toBeVisible();
    await answerQuizQuestion(page, correct(i + 1));
  }
  await expect(page.getByTestId("onboarding-profile")).toBeVisible();
  await page.getByRole("button", { name: "See my first lesson" }).click();
  await expect(page.getByTestId("first-lesson")).toBeVisible();
}

for (const [name, policy] of [
  ["answers everything right", () => true],
  ["answers everything wrong", () => false],
  ["answers every other question wrong", (n: number) => n % 2 === 1],
] as const) {
  test(`goal "articles" → first lesson is Articles when the learner ${name}`, async ({ page }) => {
    await sayArticlesThenTakeQuickCheck(page, policy);
    await expect(page.getByTestId("first-lesson")).toContainText("Articles: a, an, the");
    const reason = await page.getByTestId("first-lesson-reason").innerText();
    expect(reason).toMatch(/Articles/);
    expect(reason).not.toMatch(/Present simple|Before “/);
  });
}
