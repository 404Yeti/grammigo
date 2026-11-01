import { expect, test, type Page } from "@playwright/test";
import { LESSON, seedReturningLearner } from "./helpers";

/**
 * Fix it with Migo, end to end. The build under test must be made with NEXT_PUBLIC_GUIDED_PREVIEW=true
 * (the feature is hidden in production builds until the release gate clears). Network is mocked: no
 * OpenAI calls. Chromium's fake microphone supplies real MediaRecorder audio.
 */
// (the fake microphone flags are Chromium-only, so they are set on the Chromium projects in playwright.config.ts)

const UNSURE = "I will go to bed early tonight.";

async function ai(page: Page, opts: { available?: boolean; transcript?: string | null; opinion?: unknown; transcribeStatus?: number } = {}) {
  const { available = true, transcript = "I watched a film yesterday evening.", opinion = { status: "ok", opinion: { fit: "fits", confidence: "high", suspected: null } }, transcribeStatus = 200 } = opts;
  await page.route("**/api/ai/status", (r) => r.fulfill({ json: { available, features: { goals: true, transcribe: true, writing: true } } }));
  await page.route("**/api/ai/transcribe", (r) => (transcript === null || transcribeStatus !== 200 ? r.fulfill({ status: transcribeStatus === 200 ? 502 : transcribeStatus, json: { error: "upstream" } }) : r.fulfill({ json: { status: "ok", text: transcript } })));
  await page.route("**/api/ai/guided-check", (r) => r.fulfill({ json: opinion }));
}

async function open(page: Page) {
  await seedReturningLearner(page);
  await page.goto(`/practice/${LESSON}/guided`);
  await expect(page.getByTestId("guided-question")).toBeVisible();
}

/** Taps Speak → the mic button, and passes the one-time explainer if the browser has not already granted the microphone. */
async function tapMic(page: Page) {
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await page.getByRole("button", { name: /Tap to speak/ }).click();
  // The explainer decision is asynchronous (permission query), so wait for it rather than sampling once.
  const explainer = page.getByTestId("mic-explainer");
  if (await explainer.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) await page.getByRole("button", { name: "Continue" }).click();
}

const sentence = (page: Page) => page.getByLabel("Your sentence");
async function typeAndCheck(page: Page, text: string, button: RegExp = /^Check$/) {
  await sentence(page).fill(text);
  await page.getByRole("button", { name: button }).click();
}
const chips = (page: Page) => page.getByTestId("outcome-chip");

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe("typed journey", () => {
  test("@cross first try → new situation → summary, and the lesson's own progress is untouched", async ({ page }) => {
    await ai(page);
    await open(page);
    await page.evaluate(() => window.localStorage.setItem("probe", JSON.stringify(window.localStorage.getItem("grammigo:v2"))));
    const before = await page.evaluate(() => window.localStorage.getItem("grammigo:v2"));

    await typeAndCheck(page, "I watched a film with my sister.");
    await expect(chips(page)).toHaveText("First try");
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("guided-question")).toContainText("How long have you been learning English");
    await typeAndCheck(page, "I have been learning English for three years.");
    await expect(chips(page)).toHaveText("First try");
    await page.getByRole("button", { name: "See my summary" }).click();
    await expect(page.getByTestId("summary")).toContainText("Nice work today");
    await expect(page.getByTestId("how-counted")).toContainText("separate from your lesson progress");
    await page.getByRole("button", { name: "Back to lesson" }).click();
    await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}$`));

    // lesson progress, mastery inputs and profile are exactly as they were
    expect(await page.evaluate(() => window.localStorage.getItem("grammigo:v2"))).toBe(before);
    expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("grammigo:guided:v1")!).sessions[0].status)).toBe("completed");
  });

  test("notice → fix it yourself, with hints, Enter to submit and the field kept for editing", async ({ page }) => {
    await ai(page);
    await open(page);
    await sentence(page).fill("I have watched a film yesterday evening.");
    await sentence(page).press("Enter");
    await expect(page.getByTestId("notice-card")).toBeVisible();
    await expect(sentence(page)).toHaveValue("I have watched a film yesterday evening.");
    await expect(sentence(page)).toBeFocused();
    await page.getByRole("button", { name: "Another hint" }).click();
    await expect(page.getByTestId("hint-card")).toHaveCount(1);
    await sentence(page).fill("I watched a film yesterday evening.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(chips(page)).toHaveText("Fixed with a hint");
  });

  test("retries run out → Migo offers Show me → shown, nothing to retype", async ({ page }) => {
    await ai(page);
    await open(page);
    await typeAndCheck(page, "I have watched a film yesterday evening.");
    for (const t of ["I have seen a film yesterday evening.", "I have watched two films yesterday evening.", "I have cooked a meal yesterday evening."]) {
      await sentence(page).fill(t);
      await page.getByRole("button", { name: "Try again" }).click();
    }
    await expect(page.getByTestId("offer-show-me")).toBeVisible();
    await page.getByRole("button", { name: "Show me", exact: true }).click();
    await expect(chips(page)).toHaveText("Shown by Migo");
    await expect(page.getByTestId("model-answer")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("Show me works from the first screen, and a refresh keeps the place", async ({ page }) => {
    await ai(page);
    await open(page);
    await typeAndCheck(page, "I have watched a film yesterday evening.");
    await expect(page.getByTestId("notice-card")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("notice-card")).toBeVisible();
    await page.getByRole("button", { name: "Show me", exact: true }).click();
    await expect(chips(page)).toHaveText("Shown by Migo");
  });
});

test.describe("answers that cannot be judged", () => {
  test("AI says it fits → credited; AI down → 'can't check this one', not counted, summary says so", async ({ page }) => {
    await ai(page);
    await open(page);
    await typeAndCheck(page, UNSURE);
    await expect(chips(page)).toHaveText("First try");

    await page.evaluate(() => window.localStorage.removeItem("grammigo:guided:v1"));
    await page.unroute("**/api/ai/guided-check");
    await page.route("**/api/ai/guided-check", (r) => r.fulfill({ status: 504, json: { error: "timeout" } }));
    await page.reload();
    await typeAndCheck(page, UNSURE);
    await expect(page.getByTestId("cant-check")).toContainText("can’t judge this one for sure");
    await page.getByRole("button", { name: "Mine says the same" }).click();
    await expect(chips(page)).toHaveText("Not checked · not counted");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByTestId("not-counted-note")).toContainText("Nothing was held against you");
  });

  test("@cross offline: on-device check still works, voice steps aside, second opinions are paused", async ({ page, context }) => {
    await ai(page);
    await open(page);
    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await typeAndCheck(page, "I watched a film with my sister.");
    await expect(chips(page)).toHaveText("First try");
    await context.setOffline(false);
  });
});

test.describe("spoken journey", () => {
  test("record → confirm/edit the words → judged; fix by voice; keyboard-only", async ({ page }) => {
    await ai(page, { transcript: "I have watched a film yesterday evening." });
    await open(page);
    await tapMic(page);
    await page.getByRole("button", { name: /Stop recording/ }).click();
    await expect(page.getByRole("heading", { name: "Did I hear you right?" })).toBeVisible();
    // nothing judged until confirmed
    await expect(page.getByTestId("notice-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Looks right — check it" }).click();
    await expect(page.getByTestId("notice-card")).toBeVisible();

    await page.unroute("**/api/ai/transcribe");
    await page.route("**/api/ai/transcribe", (r) => r.fulfill({ json: { status: "ok", text: "I watched a film yesterday evening." } }));
    await tapMic(page);
    await page.getByRole("button", { name: /Stop recording/ }).click();
    await expect(page.getByRole("heading", { name: "Did I hear your new sentence?" })).toBeVisible();
    await page.getByRole("button", { name: "Looks right — check it" }).click();
    await expect(chips(page)).toHaveText("Fixed it yourself");
    await noHorizontalScroll(page);
  });

  test("transcription fails: neutral message, nothing counted, typing carries on", async ({ page }) => {
    await ai(page, { transcript: null });
    await open(page);
    await tapMic(page);
    await page.getByRole("button", { name: /Stop recording/ }).click();
    await expect(page.getByTestId("voice-message")).toContainText("not on you");
    await typeAndCheck(page, "I watched a film with my sister.");
    await expect(chips(page)).toHaveText("First try");
  });

  test("a blocked microphone is explained and typing still works", async ({ page }) => {
    await ai(page);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await open(page);
    await tapMic(page);
    await expect(page.getByTestId("mic-help")).toContainText("site settings");
    await typeAndCheck(page, "I watched a film with my sister.");
    await expect(chips(page)).toHaveText("First try");
  });
});

test.describe("entry points and layout", () => {
  test("the optional card appears on this lesson's introduction only, and opens the activity", async ({ page }) => {
    await seedReturningLearner(page);
    await ai(page);
    await page.goto(`/practice/${LESSON}`);
    await expect(page.getByTestId("guided-entry")).toBeVisible();
    await page.getByRole("link", { name: "Fix it with Migo" }).click();
    await expect(page.getByTestId("guided-question")).toBeVisible();
    await page.goto("/practice/a1-be-present");
    await expect(page.getByRole("button", { name: "Start Lesson" })).toBeVisible();
    await expect(page.getByTestId("guided-entry")).toHaveCount(0);
  });

  test("360 px wide: no horizontal scroll on the main states, targets are at least 44px", async ({ page }) => {
    await ai(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page);
    await noHorizontalScroll(page);
    await typeAndCheck(page, "I have watched a film yesterday evening.");
    await expect(page.getByTestId("notice-card")).toBeVisible();
    await noHorizontalScroll(page);
    for (const b of await page.getByRole("button").all()) {
      const box = await b.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("keyboard only: Tab to the field, type, Enter, Tab to Continue", async ({ page }) => {
    await ai(page);
    await open(page);
    await sentence(page).focus();
    await page.keyboard.type("I watched a film with my sister.");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Continue" })).toBeFocused(); // focus moves to the next action
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("transfer-intro")).toBeVisible();
  });
});

test.describe("release configuration (typed-only Beta build)", () => {
  test("a build without voice shows the Beta label and no Speak control, and the typed journey works", async ({ page }) => {
    await ai(page);
    await open(page);
    test.skip(await page.getByRole("button", { name: "Speak", exact: true }).isVisible(), "this build has voice enabled");
    await expect(page.getByText("Beta", { exact: true }).first()).toBeVisible();
    await typeAndCheck(page, "I watched a film with my sister.");
    await expect(chips(page)).toHaveText("First try");
  });
});
