import { expect, test, type Page } from "@playwright/test";
import { getLesson } from "../src/data/lessons";
import { createSession, setDraft, submitAnswer, advance } from "../src/features/practice/session";
import { emptyState } from "../src/lib/storage/schema";
import { LESSON } from "./helpers";

test.skip(process.env.E2E_SPEAKING !== "1", "Build with NEXT_PUBLIC_LESSON_SPEAKING=true and run with E2E_SPEAKING=1");
async function openSpeaking(page: Page, available = true) {
  const lesson = getLesson(LESSON)!;
  let session = createSession(lesson, "speaking-acceptance", Date.now());
  for (const q of lesson.questions.slice(0, 7)) {
    session = setDraft(session, q.acceptedAnswers[0], Date.now());
    session = advance(submitAnswer(session, lesson, Date.now()).session, Date.now());
  }
  const state = { ...emptyState(), sessions: [session], activeSessionId: session.id };
  state.onboarding.status = "skipped";
  await page.addInitScript((seed) => {
    if (!localStorage.getItem("grammigo:v2")) localStorage.setItem("grammigo:v2", JSON.stringify(seed));
  }, state);
  await page.route("**/api/ai/status", route => route.fulfill({ json: { available } }));
  await page.goto(`/practice/${LESSON}/session`);
  await expect(page.getByTestId("speaking-answer")).toBeVisible();
}
async function record(page: Page) {
  await page.getByRole("button", { name: "Record an answer" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
  // Chromium's fake microphone must emit at least one nonempty media chunk.
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Stop recording" }).click();
}

test("review transcript → targeted grammar correction → retry → finish; audio never enters storage or sync", async ({ page }, testInfo) => {
  let uploads = 0;
  const unexpected: string[] = [];
  page.on("request", request => { if (/\/api\/(sync|account)/.test(request.url())) unexpected.push(request.url()); });
  await page.route("**/api/ai/transcribe", route => { uploads++; return route.fulfill({ json: { status: "ok", text: "I have visited Paris yesterday. I watched a film yesterday." } }); });
  await openSpeaking(page);
  await record(page);
  const heard = page.getByRole("textbox", { name: "What we heard" });
  await expect(heard).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("speaking-transcript.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Check Answer" })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0].records[7].attempts)).toEqual([]);
  await page.getByRole("button", { name: "Use this transcript" }).click();
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "incorrect");
  await expect(page.getByTestId("feedback-panel")).toContainText("Finished times take the past simple");
  await page.screenshot({ path: testInfo.outputPath("speaking-correction.png"), fullPage: true });
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("textbox", { name: "Your answer" }).fill("I have visited Paris this week. I watched a film yesterday.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-assisted");
  await page.getByRole("button", { name: "Finish lesson" }).click();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  expect(uploads).toBe(1);
  expect(unexpected).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toMatch(/data:audio|base64|audio\/webm|blob:/);
});

test("recognition mistakes can be edited before any grammar judgement", async ({ page }) => {
  await page.route("**/api/ai/transcribe", route => route.fulfill({ json: { status: "ok", text: "misheard words" } }));
  await openSpeaking(page);
  await record(page);
  await page.getByRole("textbox", { name: "What we heard" }).fill("I have read a book this week. I visited my friend yesterday.");
  await page.getByRole("button", { name: "Use this transcript" }).click();
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
  await page.reload();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
});

test("no paid API or offline connection is required to finish by typing", async ({ page }) => {
  await openSpeaking(page, false);
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Your answer" }).fill("I have read a book this week. I watched a film yesterday.");
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
});

test("transcription failure offers a retry and typing without creating a wrong answer", async ({ page }) => {
  await page.route("**/api/ai/transcribe", route => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await openSpeaking(page);
  await record(page);
  await expect(page.getByTestId("speaking-answer").getByRole("alert")).toContainText("couldn’t turn that recording");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0].records[7].attempts)).toEqual([]);
  await page.getByRole("button", { name: "Type instead" }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toBeEnabled();
});


test("an uncertain spoken exercise is saved for review without paid writing evaluation", async ({ page }) => {
  let writingCalls = 0;
  await page.route("**/api/ai/writing-feedback", route => { writingCalls++; return route.fulfill({ status: 503, json: { error: "unavailable" } }); });
  await openSpeaking(page);
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("textbox", { name: "Your answer" }).fill("I enjoy the park. The weather seems pleasant.");
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "needs-review");
  await page.getByRole("button", { name: "Finish lesson" }).click();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  expect(writingCalls).toBe(0);
});
