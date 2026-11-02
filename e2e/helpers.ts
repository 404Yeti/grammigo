import { expect, type Page } from "@playwright/test";
import { listSkills } from "../src/curriculum";

export const LESSON = "present-perfect-vs-past-simple";

/**
 * Marks onboarding as skipped before the app loads, so tests about lessons start from Home like a
 * returning learner. Only seeds when nothing is stored, so refreshes keep real progress.
 */
export async function seedReturningLearner(page: Page) {
  await page.addInitScript(() => {
    if (window.localStorage.getItem("grammigo:v2") || window.localStorage.getItem("grammigo:v1")) return;
    window.localStorage.setItem(
      "grammigo:v2",
      JSON.stringify({
        version: 2,
        sessions: [],
        activeSessionId: null,
        onboarding: { status: "skipped", step: "welcome", draftText: "", draftSource: "typed", runId: null, startedAt: null, completedAt: null },
        goals: null,
        diagnosticRuns: [],
        lastRecommendation: null,
        writingFeedback: {},
      }),
    );
  });
}

export async function check(page: Page) {
  await page.getByRole("button", { name: /^(Check Answer|Try again)$/ }).click();
}

export async function cont(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Finish lesson)$/ }).click();
}

export async function expectQuestion(page: Page, n: number) {
  await expect(page.getByText(`Question ${n} of 8`, { exact: true })).toBeVisible();
}

/** Answers question n of the v0.1 lesson correctly on the first try. */
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
      if (await page.getByRole("button", { name: "Type instead", exact: true }).isVisible()) await page.getByRole("button", { name: "Type instead", exact: true }).click();
      await page.getByLabel("Your answer").fill("I have read two books this week. I watched a film yesterday.");
      break;
  }
  await check(page);
}

/** v0.1 entry: Home → choose a lesson in the library → introduction → Start Lesson. */
export async function startFromHome(page: Page, skillId = LESSON) {
  await seedReturningLearner(page);
  await page.goto("/learn");
  await page.getByRole("link", { name: "Choose another lesson" }).click();
  await expect(page.getByRole("heading", { name: "Grammar library" })).toBeVisible();
  await page.getByTestId("lesson-card").and(page.locator(`[data-skill="${skillId}"]`)).getByRole("link").click();
  await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
  await expectQuestion(page, 1);
}

/** Answers question n of ANY lesson using the curriculum's own answer keys (never AI). */
export async function answerLessonQuestion(page: Page, skillId: string, n: number) {
  const skill = listSkills().find((s) => s.id === skillId)!;
  const q = skill.questions[n - 1];
  if (q.options) {
    const correct = q.options.find((o) => o.id === q.acceptedAnswers[0])!;
    await page.getByLabel(correct.label, { exact: true }).check({ force: true });
  } else if (q.type === "sentence-construction") {
    for (const word of q.acceptedAnswers[0].split(" ")) {
      await page.getByRole("group", { name: "Available words" }).getByRole("button", { name: word, exact: true }).first().click();
    }
  } else if (q.type === "short-writing") {
    if (await page.getByRole("button", { name: "Type instead", exact: true }).isVisible()) await page.getByRole("button", { name: "Type instead", exact: true }).click();
    await page.getByLabel("Your answer").fill("I have a good plan for today. She is my friend and we are happy.");
  } else {
    await page.getByLabel("Your answer").fill(q.acceptedAnswers[0]);
  }
  await check(page);
}

export async function playWholeLesson(page: Page, skillId: string) {
  for (let n = 1; n <= 8; n++) {
    await expectQuestion(page, n);
    await answerLessonQuestion(page, skillId, n);
    await cont(page);
  }
}

/** Finds the diagnostic question currently on screen and answers it with the curriculum's key. */
export async function answerQuizQuestion(page: Page, correct: boolean) {
  const prompt = (await page.locator("#question-prompt").innerText()).replace(/\s+/g, " ").trim();
  const labels = await page.locator('input[type="radio"]').evaluateAll((els) =>
    els.map((el) => (el.closest("label")?.textContent ?? "").replace(/(Correct|Not quite)$/, "").trim()),
  );
  const skills = listSkills();
  const norm = (s: string) => s.replace(/___/g, "____").replace(/\s+/g, " ").trim();
  const match = skills
    .flatMap((s) => s.questions)
    .find(
      (q) =>
        norm(q.prompt) === prompt &&
        (q.options ? [...q.options.map((o) => o.label)].sort().join("|") === [...labels].sort().join("|") : labels.length === 0),
    );
  if (!match) {
    await page.getByRole("button", { name: "Skip this one" }).click();
    return;
  }
  if (match.options) {
    const right = match.acceptedAnswers[0];
    const pick = match.options.find((o) => (correct ? o.id === right : o.id !== right))!;
    await page.getByLabel(pick.label, { exact: true }).check({ force: true });
  } else {
    await page.getByLabel("Your answer").fill(correct ? match.acceptedAnswers[0] : "zzz");
  }
  await page.getByRole("button", { name: "Next" }).click();
}
