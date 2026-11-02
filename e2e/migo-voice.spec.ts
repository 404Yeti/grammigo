import { expect, test } from "@playwright/test";
import { LESSON, seedReturningLearner } from "./helpers";

test.skip(process.env.E2E_MIGO_VOICE !== "1", "Requires NEXT_PUBLIC_MIGO_VOICE=true build");
function silenceWav() {
  const audio = Buffer.alloc(44 + 1600);
  audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(1600, 40);
  return audio;
}
test("audio is explicit, replay is cached, mute survives refresh, and only public IDs are sent", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/tts", route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ lessonId: LESSON, questionId: "q1", kind: "instruction" });
    return route.fulfill({ contentType: "audio/wav", body: silenceWav() });
  });
  await seedReturningLearner(page);
  await page.goto(`/practice/${LESSON}`);
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.getByTestId("migo-audio")).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Listen to Migo" }).click();
  await expect(page.getByRole("button", { name: "Replay Migo" })).toBeEnabled();
  await page.getByRole("button", { name: "Replay Migo" }).click();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Mute Migo", exact: true }).click();
  await expect(page.getByText("Migo is muted on this device.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Listen to Migo" })).toBeDisabled();
  await page.getByRole("button", { name: "Unmute Migo" }).click();
  expect(calls).toBe(1); // unmuting must not autoplay or request more audio
  await expect(page.getByRole("button", { name: "Listen to Migo" })).toBeEnabled();
});
test("TTS failure does not block an ordinary answer or lesson navigation", async ({ page }) => {
  await page.route("**/api/ai/tts", route => route.fulfill({ status: 503, json: { error: "voice_unavailable" } }));
  await seedReturningLearner(page);
  await page.goto(`/practice/${LESSON}`);
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await page.getByRole("button", { name: "Listen to Migo" }).click();
  await expect(page.getByText(/Audio is unavailable/)).toBeVisible();
  await page.getByLabel("I have visited Hanoi twice.").check({ force: true });
  await page.getByRole("button", { name: "Check Answer" }).click();
  await expect(page.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Question 2 of 8", { exact: true })).toBeVisible();
});


test("the synthesis endpoint is closed when its server flag is off", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/tts", { headers: { origin: baseURL! }, data: { lessonId: LESSON, questionId: "q1", kind: "instruction" } });
  expect(response.status()).toBe(503);
});
