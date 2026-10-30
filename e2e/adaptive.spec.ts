import { expect, test } from "@playwright/test";
import { createSession } from "../src/features/practice/session";
import { getLesson } from "../src/data/lessons";
import {
  answerQuizQuestion,
  cont,
  expectQuestion,
  LESSON,
  playWholeLesson,
  seedReturningLearner,
  startFromHome,
} from "./helpers";

test.describe("onboarding: the acceptance journey", () => {
  test("tell Migo what is hard → quick adaptive check → profile → first lesson, never choosing a level", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText("What would you like to improve about your English?")).toBeVisible();
    await expect(page.getByTestId("voice-unavailable")).toBeVisible(); // AI is off: typing only, said honestly

    await page.getByRole("button", { name: "Type it" }).click();
    await page.getByLabel("Tell Migo in your own words").fill("I always mix up past simple and present perfect");
    await page.getByRole("button", { name: "Continue" }).click();

    const chips = page.getByTestId("goal-chips");
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(/Present perfect|Past simple/);
    await page.getByRole("button", { name: "Start the quick check" }).click();

    // answer an adaptive quiz of 5–10 questions; the learner never picks a level
    let asked = 0;
    for (let i = 0; i < 12 && !(await page.getByTestId("onboarding-profile").isVisible()); i++) {
      await expect(page.getByText(`Quick check · question ${i + 1}`)).toBeVisible();
      await answerQuizQuestion(page, i % 3 !== 2);
      asked++;
    }
    await expect(page.getByTestId("onboarding-profile")).toBeVisible();
    expect(asked).toBeGreaterThanOrEqual(5);
    expect(asked).toBeLessThanOrEqual(10);
    await expect(page.getByTestId("profile-caveat")).toContainText("not a CEFR level");
    expect(await page.locator("body").innerText()).not.toMatch(/choose your level|select your level/i);

    await page.getByRole("button", { name: "See my first lesson" }).click();
    await expect(page.getByTestId("first-lesson-reason")).not.toBeEmpty();
    await page.getByRole("button", { name: "Start My First Lesson" }).click();

    await expect(page).toHaveURL(/\/practice\/[a-z0-9-]+\/session$/);
    await expectQuestion(page, 1);
  });

  test("a general grammar check can be started by skipping the conversation", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByRole("button", { name: /Skip, start a general grammar check/ }).click();
    await expect(page.getByText("Quick check · question 1")).toBeVisible();
  });

  test("refresh mid-quiz resumes on the same question", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Type it" }).click();
    await page.getByLabel("Tell Migo in your own words").fill("articles");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Start the quick check" }).click();
    await answerQuizQuestion(page, true);
    await answerQuizQuestion(page, false);
    await expect(page.getByText("Quick check · question 3")).toBeVisible();
    const prompt = await page.locator("#question-prompt").innerText();

    await page.reload();
    await expect(page.getByText("Quick check · question 3")).toBeVisible();
    expect(await page.locator("#question-prompt").innerText()).toBe(prompt);
  });

  test("a learner can skip the whole conversation and still reach Home", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: "Start Practice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tell Migo" })).toBeVisible();
  });
});

test.describe("library and multiple lessons", () => {
  test("browse, filter, choose a lesson and finish it; progress shows in the library and Home", async ({ page }) => {
    await seedReturningLearner(page);
    await page.goto("/library");
    await expect(page.getByTestId("lesson-card")).toHaveCount(12);

    await page.getByRole("group", { name: "Level" }).getByRole("button", { name: "A1" }).click();
    await expect(page.getByTestId("lesson-card")).toHaveCount(3);
    await expect(page.getByRole("group", { name: "Level" }).getByRole("button", { name: /C1/ })).toBeDisabled();

    await page.getByTestId("lesson-card").and(page.locator('[data-skill="a1-articles"]')).getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Articles: a, an, the" })).toBeVisible();
    await page.getByText("Quick refresher: the rule").click();
    await expect(page.getByTestId("refresher")).toContainText("a/an for one of many");
    await page.getByRole("button", { name: "Start Lesson" }).click();
    await playWholeLesson(page, "a1-articles");

    // writing in a non-v0.1 lesson cannot be graded deterministically, and AI is off: saved for review, not penalized
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
    await expect(page.getByTestId("success-notices")).toContainText("saved for review");
    await expect(page.getByTestId("stat-tile").nth(1)).toContainText("7");

    await page.goto("/library");
    const card = page.getByTestId("lesson-card").and(page.locator('[data-skill="a1-articles"]'));
    await expect(card.getByTestId("completion")).toHaveText("Completed 1×");
    await expect(card).not.toContainText("Strong"); // one lesson is not mastery
  });

  test("recommendations adapt: after a lesson Home explains what changed and why", async ({ page }) => {
    await startFromHome(page, "a1-be-present");
    await playWholeLesson(page, "a1-be-present");
    await page.goto("/");
    const reason = page.getByTestId("next-step-text");
    await expect(reason).toContainText("You finished “Present simple of “be””");
    await expect(page.getByTestId("home-independent")).toContainText("7");
  });
});

test.describe("compatibility with v0.1", () => {
  test("a completed v0.1 session in the old storage format is migrated and stays reviewable", async ({ page }) => {
    const lesson = getLesson(LESSON)!;
    // build a genuine v0.1-format document (version 1) with a completed, all-independent session
    let s = createSession(lesson, "legacy-1", 1_700_000_000_000);
    s = { ...s, status: "completed", completedAt: 1_700_000_300_000, activeMs: 300_000, currentIndex: 7, phase: "feedback" };
    s = {
      ...s,
      records: s.records.map((r, i) => ({
        ...r,
        attempts: [{ answer: "x", verdict: "correct" as const, at: 1_700_000_000_000 + i, hintsUsed: 0, hintsUsedBefore: 0 }],
        classification: "correct_first_try" as const,
        resolution: "correct" as const,
        finalAnswer: "x",
      })),
    };
    const v1 = JSON.stringify({ version: 1, sessions: [s], activeSessionId: null });
    await page.addInitScript((doc) => window.localStorage.setItem("grammigo:v1", doc), v1);

    await page.goto("/");
    await expect(page).toHaveURL("/"); // not forced through onboarding
    await expect(page.getByTestId("home-independent")).toContainText("8");

    await page.getByRole("link", { name: "Review last lesson" }).click();
    await expect(page.getByTestId("review-card")).toHaveCount(8);
    // the original v0.1 data is still there as a backup
    expect(await page.evaluate(() => window.localStorage.getItem("grammigo:v1"))).toContain("legacy-1");
  });
});

test.describe("AI is closed by default", () => {
  test("status reports unavailable and every AI endpoint refuses without calling a model", async ({ page, baseURL }) => {
    const status = await page.request.get("/api/ai/status");
    expect((await status.json()).available).toBe(false);

    const headers = { origin: baseURL!, "content-type": "application/json" };
    const goals = await page.request.post("/api/ai/goals", { headers, data: { text: "past tense" } });
    expect(goals.status()).toBe(503);
    // "disabled" with a clean environment; "not_configured" when a developer's .env.local has AI on but
    // production has no durable rate limiter. Either way production refuses, which is the invariant.
    expect(["disabled", "not_configured"]).toContain((await goals.json()).reason);
    expect((await page.request.post("/api/ai/writing-feedback", { headers, data: { skillId: "a2-past-simple", questionId: "q8", text: "I went. I saw." } })).status()).toBe(503);
    expect((await page.request.post("/api/ai/transcribe", { headers: { origin: baseURL! }, multipart: { audio: { name: "a.webm", mimeType: "audio/webm", buffer: Buffer.from("x") } } })).status()).toBe(503);
  });

  test("cross-site requests are refused even when AI is off or on", async ({ page }) => {
    const res = await page.request.post("/api/ai/goals", { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { text: "x y" } });
    expect([403, 503]).toContain(res.status());
  });

  test("the lesson stays fully playable without AI (writing is saved, not blocked)", async ({ page }) => {
    await startFromHome(page, "a1-present-simple");
    await playWholeLesson(page, "a1-present-simple");
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
    void cont;
  });
});
