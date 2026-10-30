import { expect, type Page } from "@playwright/test";

export const LESSON = "present-perfect-vs-past-simple";

export async function check(page: Page) {
  await page.getByRole("button", { name: /^(Check Answer|Try again)$/ }).click();
}

export async function cont(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Finish lesson)$/ }).click();
}

export async function expectQuestion(page: Page, n: number) {
  await expect(page.getByText(`Question ${n} of 8`, { exact: true })).toBeVisible();
}

/** Answers question n correctly on the first try. */
export async function answerCorrectly(page: Page, n: number) {
  switch (n) {
    case 1:
      await page.getByLabel("I have visited Hanoi twice.").check({ force: true });
      break;
    case 2:
      await page.getByLabel("Your answer").fill("watched");
      break;
    case 3:
      await page.getByLabel("since", { exact: true }).check({ force: true });
      break;
    case 4:
      await page.getByLabel("Your answer").fill("I saw that film yesterday.");
      break;
    case 5:
      for (const word of ["They", "have", "lived", "here", "since", "2018"]) {
        await page.getByRole("group", { name: "Available words" }).getByRole("button", { name: word, exact: true }).click();
      }
      break;
    case 6:
      await page.getByLabel("Your answer").fill("left");
      break;
    case 7:
      await page.getByLabel("Your answer").fill("I have been learning English since 2020.");
      break;
    case 8:
      await page
        .getByLabel("Your answer")
        .fill("I have read two books this week. I watched a film yesterday.");
      break;
  }
  await check(page);
}

export async function startFromHome(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Start Practice" }).click();
  await expect(page.getByRole("heading", { name: "Present Perfect vs. Past Simple" })).toBeVisible();
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expectQuestion(page, 1);
}
