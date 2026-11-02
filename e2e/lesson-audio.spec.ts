import { expect, test, type Page } from "@playwright/test";
import { getLesson } from "../src/data/lessons";
import { createSession, setDraft, submitAnswer, advance } from "../src/features/practice/session";
import { emptyState } from "../src/lib/storage/schema";
import { LESSON, answerCorrectly, cont, seedReturningLearner } from "./helpers";

test.skip(process.env.E2E_LISTENING !== "1", "Requires listening build");
const scenario = "I love travelling. Hanoi is one of my favourite cities, and I have been there twice. I hope to return someday.";
function wav() {
  const audio = Buffer.alloc(1644);
  audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(1600, 40);
  return audio;
}
async function construction(page: Page) {
  const lesson = getLesson(LESSON)!;
  let session = createSession(lesson, "construction-acceptance", Date.now());
  for (const q of lesson.questions.slice(0, 4)) session = advance(submitAnswer(setDraft(session, q.acceptedAnswers[0], Date.now()), lesson, Date.now()).session, Date.now());
  const seed = { ...emptyState(), sessions: [session], activeSessionId: session.id };
  seed.onboarding.status = "skipped";
  await page.addInitScript(s => { if (!localStorage.getItem("grammigo:v2")) localStorage.setItem("grammigo:v2", JSON.stringify(s)); }, seed);
  await page.route("**/api/ai/status", r => r.fulfill({ json: { available: true } }));
  await page.goto(`/practice/${LESSON}/session`);
  await page.getByRole("button", { name: "Speak or type my sentence", exact: true }).click();
  await expect(page.getByText(/Use these words:/)).toContainText("since · They · 2018 · lived · here · have");
}
async function reachListening(page: Page) {
  await seedReturningLearner(page); await page.goto(`/practice/${LESSON}`);
  await page.getByRole("button", { name: "Start Lesson", exact: true }).click();
  for (let n = 1; n <= 8; n++) { await answerCorrectly(page, n); await cont(page); }
}
test("listening uses authored audio, hides transcript, and supports replay, persisted mute and deterministic answers", async ({ page }, info) => {
  let calls = 0; const grading: string[] = [];
  page.on("request", r => { if (/\/api\/ai\/(writing-feedback|guided-check)/.test(r.url())) grading.push(r.url()); });
  await page.route("**/api/ai/tts", r => {
    if (r.request().postDataJSON().kind === "listening") {
      calls++;
      expect(r.request().postDataJSON()).toEqual({ lessonId: LESSON, questionId: "q9-listening", kind: "listening" });
    }
    return r.fulfill({ contentType: "audio/wav", body: wav() });
  });
  await reachListening(page);
  await expect(page.getByTestId("listening-exercise")).toBeVisible();
  expect(calls).toBe(0);
  await expect(page.getByText(scenario, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Listen to Migo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay Migo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Replay Migo", exact: true }).click(); expect(calls).toBe(1);
  await expect(page.getByText(scenario, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("listening-before-answer.png"), fullPage: true });
  await page.getByRole("button", { name: "Mute Migo", exact: true }).click(); await page.reload();
  await expect(page.getByRole("button", { name: "Listen to Migo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Unmute Migo", exact: true }).click(); expect(calls).toBe(1);
  await page.getByLabel("I have visited Hanoi twice.", { exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Check Answer", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
  await expect(page.getByTestId("listening-transcript")).toContainText(scenario);
  await page.screenshot({ path: info.outputPath("listening-feedback.png"), fullPage: true });
  await page.getByRole("button", { name: "Finish lesson", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  expect(grading).toEqual([]);
});
test("audio failure or mute always has an explicit accessible reading alternative", async ({ page }) => {
  await page.route("**/api/ai/tts", r => r.fulfill({ status: 503, json: { error: "voice_unavailable" } }));
  await reachListening(page);
  await page.getByRole("button", { name: "Listen to Migo", exact: true }).click();
  await expect(page.getByText(/Audio is unavailable/)).toBeVisible();
  await expect(page.getByText(scenario, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Read instead/ }).click();
  await expect(page.getByTestId("listening-transcript")).toContainText(scenario);
  await page.getByLabel("I have visited Hanoi twice.", { exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Check Answer", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
});
test("construction mic denial falls back to typing, grammar correction and retry without AI grading", async ({ page }, info) => {
  const grading: string[] = [];
  page.on("request", r => { if (/\/api\/ai\/(writing-feedback|guided-check)/.test(r.url())) grading.push(r.url()); });
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
  await construction(page);
  await page.getByRole("button", { name: "Record an answer", exact: true }).click();
  await expect(page.getByTestId("speaking-answer").getByRole("alert")).toContainText("denied");
  await page.screenshot({ path: info.outputPath("construction-mic-denied.png"), fullPage: true });
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your answer").fill("They has lived here since 2018.");
  await page.getByRole("button", { name: "Check Answer", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "incorrect");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByLabel("Your answer").fill("They have lived here since 2018.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-assisted");
  await page.screenshot({ path: info.outputPath("construction-typed-retry.png"), fullPage: true });
  expect(grading).toEqual([]);
});
test("construction transcript can be corrected before grammar grading and survives refresh as confirmed text", async ({ page }, info) => {
  await page.route("**/api/ai/transcribe", r => r.fulfill({ json: { status: "ok", text: "They has lived here since 2018." } }));
  await construction(page);
  await page.getByRole("button", { name: "Record an answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.getByLabel("What we heard")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0].records[4].attempts)).toEqual([]);
  await page.getByLabel("What we heard").fill("They have lived here since 2018.");
  await page.screenshot({ path: info.outputPath("construction-transcript-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Use this transcript", exact: true }).click();
  await page.getByRole("button", { name: "Check Answer", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0].records[4].finalAnswer)).toBe("They have lived here since 2018.");
});

test("construction transcription failure creates no wrong attempt and typing can finish offline", async ({ page }) => {
  await page.route("**/api/ai/transcribe", r => r.fulfill({ status: 503, json: { error: "unavailable" } }));
  await construction(page);
  await page.getByRole("button", { name: "Record an answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.getByTestId("speaking-answer").getByRole("alert")).toContainText("couldn’t turn");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0].records[4].attempts)).toEqual([]);
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.context().setOffline(true);
  await page.getByLabel("Your answer").fill("They have lived here since 2018.");
  await page.getByRole("button", { name: "Check Answer", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
});
