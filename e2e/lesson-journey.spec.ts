import { expect, test } from "@playwright/test";
import { answerCorrectly, check, cont, expectQuestion, LESSON, seedReturningLearner, startFromHome } from "./helpers";

test("@cross full journey: Home → Intro → 8 questions → Success → Review → Return Home", async ({ page }) => {
  await startFromHome(page);

  // Q1–Q3 correct first try
  for (const n of [1, 2, 3]) {
    await answerCorrectly(page, n);
    await expect(page.getByTestId("feedback-chip")).toHaveText(/Counts as independent/);
    await cont(page);
  }

  // Q4: wrong → hint → retry → corrected after help
  await expectQuestion(page, 4);
  await page.getByLabel("Your answer").fill("I have seen that film last night.");
  await check(page);
  const panel = page.getByTestId("feedback-panel");
  await expect(panel).toHaveAttribute("data-kind", "incorrect");
  await panel.getByRole("button", { name: "Get a hint" }).click();
  await expect(page.getByTestId("hint-card")).toContainText("Hint 1 of 2");
  await page.getByLabel("Your answer").fill("I saw that film yesterday.");
  await check(page);
  await expect(page.getByTestId("feedback-chip")).toHaveText(/Corrected after help/);
  await cont(page);

  for (const n of [5, 6, 7, 8]) {
    await expectQuestion(page, n);
    await answerCorrectly(page, n);
    await expect(page.getByTestId("feedback-chip")).toHaveText(/Counts as independent/);
    await cont(page);
  }

  // Success page: accurate numbers
  await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  const tiles = page.getByTestId("stat-tile");
  await expect(tiles.nth(0)).toContainText("8");
  await expect(tiles.nth(1)).toContainText("7");
  await expect(tiles.nth(2)).toContainText("1");

  // Review: real attempt history
  await page.getByRole("link", { name: "Review My Lesson" }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/review`));
  await expect(page.getByRole("heading", { name: "Your Lesson Review" })).toBeVisible();
  const cards = page.getByTestId("review-card");
  await expect(cards).toHaveCount(8);
  await expect(cards.nth(3)).toHaveAttribute("data-result", "correct_after_hint");
  await cards.nth(3).getByRole("button").click();
  await expect(cards.nth(3).getByTestId("review-details")).toContainText("I have seen that film last night.");
  await expect(cards.nth(3).getByTestId("review-details")).toContainText("1 hint, then 1 retry");

  // Return Home shows the updated summary
  await page.getByRole("link", { name: "Return Home" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("home-independent")).toContainText("7");
  await expect(page.getByTestId("home-assisted")).toContainText("1");
});

test("@cross progress survives a refresh and Exit → Home → Continue Lesson resumes", async ({ page }) => {
  await startFromHome(page);
  for (const n of [1, 2, 3]) {
    await answerCorrectly(page, n);
    await cont(page);
  }
  await expectQuestion(page, 4);
  await page.getByLabel("Your answer").fill("I saw");

  await page.reload();
  await expectQuestion(page, 4);
  await expect(page.getByLabel("Your answer")).toHaveValue("I saw");

  await page.getByRole("button", { name: "Exit lesson" }).click();
  await expect(page.getByRole("dialog", { name: "Leave this lesson?" })).toBeVisible();
  await page.getByRole("button", { name: /Save & Exit/ }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("next-step-text")).toContainText("question 4 of 8");

  await page.getByRole("link", { name: "Continue Lesson" }).click();
  await expectQuestion(page, 4);
});

test("Practice This Skill Again starts a fresh attempt and keeps the completed one", async ({ page }) => {
  await startFromHome(page);
  for (let n = 1; n <= 8; n++) {
    await expectQuestion(page, n);
    await answerCorrectly(page, n);
    await cont(page);
  }
  await page.getByRole("link", { name: "Review My Lesson" }).click();
  await page.getByRole("button", { name: "Practice This Skill Again" }).click();
  await expectQuestion(page, 1);
  await expect(page.getByLabel("I have visited Hanoi twice.")).not.toBeChecked();

  // The completed attempt is still reviewable from Home
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Continue Lesson" })).toBeVisible();
  await page.getByRole("link", { name: "Review last lesson" }).click();
  await expect(page.getByTestId("review-card")).toHaveCount(8);
});

test("works with the keyboard alone", async ({ page }) => {
  await startFromHome(page);
  await page.getByLabel("I have visited Hanoi twice.").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter"); // submits the form
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectQuestion(page, 2);
});

test("no horizontal overflow on key screens", async ({ page }) => {
  await seedReturningLearner(page);
  for (const path of ["/", "/library", `/practice/${LESSON}`]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
