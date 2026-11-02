import { expect, test, type Page } from "@playwright/test";
import { listSkills } from "../src/curriculum";
import { answerLessonQuestion, cont, seedReturningLearner } from "./helpers";

test.skip(process.env.E2E_LISTENING !== "1" || process.env.E2E_MIGO_VOICE !== "1", "Requires production lesson/audio flags");
function wav() {
  const b = Buffer.alloc(1644);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(1600, 40); return b;
}
async function audio(page: Page, blocked = false) {
  await page.addInitScript(({ blocked }) => {
    const realPlay = HTMLMediaElement.prototype.play;
    (window as unknown as { migoPlays: number }).migoPlays = 0;
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.startsWith("data:")) {
        (window as unknown as { migoPlays: number }).migoPlays++;
        if (blocked) return Promise.reject(new DOMException("User gesture required", "NotAllowedError"));
      }
      return realPlay.call(this);
    };
  }, { blocked });
  const calls: { kind: string; questionId: string }[] = [];
  await page.route("**/api/ai/tts", route => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "audio/wav", body: wav() });
  });
  // Only authored lesson content is involved; no live paid services in browser tests.
  await page.route("**/api/ai/status", route => route.fulfill({ json: { available: false } }));
  return calls;
}
for (const skill of listSkills()) {
  test(`complete rendered lesson includes listening: ${skill.id}`, async ({ page }) => {
    await audio(page);
    await seedReturningLearner(page);
    await page.goto(`/practice/${skill.id}`);
    await page.getByRole("button", { name: "Start Lesson", exact: true }).click();
    for (let n = 1; n <= 8; n++) { await answerLessonQuestion(page, skill.id, n); await cont(page); }
    await expect(page.getByTestId("listening-exercise")).toBeVisible();
    await expect(page.getByTestId("listening-transcript")).toHaveCount(0);
    await expect(page.getByText("Question 9 of 9", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Listen to Migo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Replay Migo", exact: true })).toBeEnabled();
    await answerLessonQuestion(page, skill.id, 9);
    await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
    await expect(page.getByTestId("listening-transcript")).toBeVisible();
    await cont(page);
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("grammigo:v2")!).sessions[0]);
    expect(saved.status).toBe("completed");
    expect(saved.records.filter((r: { questionId: string }) => r.questionId === "q9-listening")).toHaveLength(1);
  });
}

test("@cross automatic correct, wrong, retry and success feedback; refresh and replay do not duplicate", async ({ page }, info) => {
  const calls = await audio(page);
  await seedReturningLearner(page);
  await page.goto("/practice/a1-be-present");
  await page.getByRole("button", { name: "Start Lesson", exact: true }).click();
  await page.getByLabel("She am a teacher.", { exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("migo-spoken-text")).toContainText("Good try.");
  await expect.poll(() => calls.some(c => c.kind === "supportive")).toBe(true);
  await expect(page.getByRole("button", { name: "Replay Migo" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("automatic-grammar-feedback.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("migo-spoken-text")).toContainText("Good try.");
  expect(calls.filter(c => c.kind === "supportive")).toHaveLength(1);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  expect(calls.filter(c => c.kind === "supportive")).toHaveLength(1);
  await page.getByLabel("She is a teacher.", { exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => calls.filter(c => c.kind === "positive").length).toBe(1);
  await expect(page.getByRole("button", { name: "Replay Migo" })).toBeEnabled();
  await page.getByRole("button", { name: "Replay Migo" }).click();
  expect(calls.filter(c => c.kind === "positive")).toHaveLength(1);
  await cont(page);
  for (let n = 2; n <= 8; n++) { await answerLessonQuestion(page, "a1-be-present", n); await cont(page); }
  await expect(page.getByTestId("listening-exercise")).toBeVisible();
  await page.screenshot({ path: info.outputPath("listening-hidden-transcript.png"), fullPage: true });
  await page.getByRole("button", { name: "Listen to Migo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay Migo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Replay Migo", exact: true }).click();
  expect(calls.filter(c => c.kind === "listening")).toHaveLength(1);
  await answerLessonQuestion(page, "a1-be-present", 9);
  await cont(page);
  await expect.poll(() => calls.filter(c => c.kind === "celebration").length).toBe(1);
  await expect(page.getByTestId("migo-spoken-text")).toContainText("You did it, amigo!");
  await page.screenshot({ path: info.outputPath("automatic-celebration.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  expect(calls.filter(c => c.kind === "celebration")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "positive")).toHaveLength(1); // reusable response across questions
});

test("@cross browser-denied autoplay offers replay, and persistent mute suppresses all automatic requests", async ({ page }, info) => {
  const calls = await audio(page, true);
  await seedReturningLearner(page);
  await page.goto("/practice/a1-be-present");
  await page.getByRole("button", { name: "Start Lesson", exact: true }).click();
  await answerLessonQuestion(page, "a1-be-present", 1);
  await expect(page.getByRole("button", { name: "Replay Migo" })).toBeEnabled();
  await expect(page.getByText(/Tap replay if your browser paused/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("safari-autoplay-replay.png"), fullPage: true });
  await page.getByRole("button", { name: "Mute Migo", exact: true }).click();
  const paid = calls.length;
  await cont(page);
  await answerLessonQuestion(page, "a1-be-present", 2);
  await expect(page.getByText("Migo is muted on this device.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Migo is muted on this device.")).toBeVisible();
  expect(calls).toHaveLength(paid);
  await page.getByRole("button", { name: "Unmute Migo" }).click();
  expect(calls).toHaveLength(paid);
  await expect(page.getByRole("button", { name: "Listen to Migo" })).toBeEnabled();
});
