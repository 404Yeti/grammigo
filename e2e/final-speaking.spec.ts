import { expect, test, type Page } from "@playwright/test";
import { listSkills } from "../src/curriculum";
import { getLesson } from "../src/data/lessons";
import { listeningQuestion } from "../src/data/lessons/listening";
import { createSession } from "../src/features/practice/session";
import { emptyState } from "../src/lib/storage/schema";

async function open(page: Page, lessonId = "a1-be-present") {
  const lesson = getLesson(lessonId)!;
  // CI passes runtime feature switches as E2E flags rather than NEXT_PUBLIC build flags.
  const listening = process.env.E2E_LISTENING === "1" ? listeningQuestion(lesson) : null;
  const runtimeLesson = listening && !lesson.questions.some(q => q.id === listening.id)
    ? { ...lesson, questions: [...lesson.questions, listening] } : lesson;
  const session = createSession(runtimeLesson, "challenge-browser", Date.now());
  session.currentIndex = session.records.length - 1;
  session.phase = "feedback";
  session.records = session.records.map(r => ({ ...r, resolution: "needs_review" }));
  const seed = { ...emptyState(), sessions: [session], activeSessionId: session.id };
  seed.onboarding.status = "skipped";
  await page.addInitScript(s => { if (!localStorage.getItem("grammigo:v2")) localStorage.setItem("grammigo:v2", JSON.stringify(s)); }, seed);
  await page.route("**/api/ai/status", r => r.fulfill({ json: { available: true } }));
  await page.route("**/api/ai/tts", r => r.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto(`/practice/${lessonId}/session`);
  await page.getByRole("button", { name: "Finish lesson", exact: true }).click();
  await expect(page.getByText("Final speaking challenge", { exact: true })).toBeVisible();
}
const feedback = { outcome: "needs_work", confidence: "high", errors: [{ original: "I is", correction: "I am", explanation: "Use am with I." }], suggestedCorrection: "I am a student. My friend is kind.", explanation: "You used is with my friend correctly. Use am with I.", example: null, assessedSkillIds: ["a1-be-present"] };

test("record → recognized transcript → feedback → one guided correction → success, with refresh", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 800 });
  await page.context().grantPermissions(["microphone"]);
  let calls = 0;
  await page.route("**/api/ai/transcribe", r => r.fulfill({ json: { status: "ok", text: "I is a student. My friend is kind." } }));
  await page.route("**/api/ai/speaking-feedback", r => {
    calls++;
    return r.fulfill({ json: { status: "ok", feedback: calls === 1 ? feedback : { ...feedback, outcome: "meets_goal", errors: [], suggestedCorrection: null, explanation: "You used am with I and is with my friend correctly." } } });
  });
  await open(page);
  await page.getByRole("button", { name: "Record an answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByLabel("What we heard")).toHaveValue("I is a student. My friend is kind.");
  await page.reload();
  await expect(page.getByLabel("Your answer")).toHaveValue("I is a student. My friend is kind.");
  await page.getByRole("button", { name: "Check my response" }).click();
  await expect(page.getByRole("region", { name: "Speaking feedback" })).toContainText("Use am with I");
  await page.reload();
  await page.getByRole("button", { name: "Try one guided correction" }).click();
  await page.getByLabel("Your answer").fill("I am a student. My friend is kind.");
  await page.getByRole("button", { name: "Check my response" }).click();
  await expect(page.getByText("You used the target grammar.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try one guided correction" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("final-speaking.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Finish lesson", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  expect(calls).toBe(2);
});

test("microphone denial and provider outage never block completion", async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
  await page.route("**/api/ai/speaking-feedback", r => r.fulfill({ status: 503, json: { error: "unavailable" } }));
  await open(page);
  await page.getByRole("button", { name: "Record an answer", exact: true }).click();
  await expect(page.getByTestId("speaking-answer").getByRole("alert")).toContainText("denied");
  await page.getByRole("button", { name: "Type instead", exact: true }).click();
  await page.getByLabel("Your answer").fill("I am happy.");
  await page.getByRole("button", { name: "Check my response" }).click();
  await expect(page.getByRole("region", { name: "Speaking feedback" })).toContainText("Not verified");
  await page.getByRole("button", { name: "Finish lesson", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
});

for (const skill of listSkills()) {
  test(`final challenge is reachable and skippable: ${skill.id}`, async ({ page }) => {
    await open(page, skill.id);
    await page.reload();
    await expect(page.getByText("Final speaking challenge", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Skip speaking and finish lesson" }).click();
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
  });
}
