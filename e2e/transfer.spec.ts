import { createReadStream } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectQuestion, LESSON, playWholeLesson, seedReturningLearner } from "./helpers";

/**
 * Guest progress carried from the old web address to the new one, in a real browser with TWO origins (two local servers of the same build:
 * localhost:3105 plays grammigo.vercel.app, localhost:3100 plays grammigo.si). Needs the build with the transfer switched on (CI sets it).
 */
test.skip(process.env.E2E_TRANSFER !== "1", "needs the build with NEXT_PUBLIC_GUEST_TRANSFER=on (see CI)");

const TARGET = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SOURCE = `http://localhost:${process.env.E2E_TRANSFER_SOURCE_PORT ?? 3105}`;
const KEY = "grammigo:v2";
const read = (p: Page) => p.evaluate((k) => window.localStorage.getItem(k), KEY);

/** One browser context (so the two origins can talk through a real pop-up). Progress is made as a guest on the OLD origin. */
async function oldAddressWithProgress(browser: Browser): Promise<{ ctx: BrowserContext; old: Page; before: string }> {
  const ctx = await browser.newContext({ baseURL: SOURCE });
  const old = await ctx.newPage();
  await seedReturningLearner(old);
  await old.goto("/practice/" + LESSON);
  await old.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
  await expectQuestion(old, 1);
  await playWholeLesson(old, LESSON);
  await expect(old).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
  const before = (await read(old))!;
  expect(JSON.parse(before).sessions).toHaveLength(1);
  return { ctx, old, before };
}
const completed = (p: Page) => p.getByTestId("lesson-card").and(p.locator(`[data-skill="${LESSON}"]`)).getByTestId("completion");

test.describe("moving a guest's progress to the new address", () => {
  test("@cross one tap each side: preview first, nothing written until confirmed, the old copy untouched, then it is in the library", async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, old, before } = await oldAddressWithProgress(browser);
    const mine = await ctx.newPage();
    await mine.goto(`${TARGET}/transfer/receive`);
    expect(await read(mine)).toBeNull(); // the new address knows nothing yet
    await expect(mine.getByTestId("transfer-begin")).toBeVisible();

    const [popup] = await Promise.all([ctx.waitForEvent("page"), mine.getByTestId("transfer-begin").click()]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).origin).toBe(SOURCE);
    await expect(popup.getByTestId("transfer-send-summary")).toContainText("1 lesson finished");
    await expect(mine.getByTestId("transfer-waiting")).toBeVisible();
    expect(await read(mine)).toBeNull(); // opening the window moved nothing

    await popup.getByTestId("transfer-send-button").click();
    await expect(mine.getByTestId("transfer-preview-text")).toContainText("New to this device: 1 lesson finished");
    expect(await read(mine)).toBeNull(); // the preview wrote nothing

    await mine.getByTestId("transfer-confirm").click();
    await expect(mine.getByTestId("transfer-done")).toBeVisible();
    await expect(popup.getByTestId("transfer-arrived")).toBeVisible();
    expect(JSON.parse((await read(mine))!).sessions).toHaveLength(1);
    expect(await read(old)).toBe(before); // the old address's copy is byte-for-byte what it was

    await mine.goto(`${TARGET}/library`);
    await expect(completed(mine)).toContainText("Completed 1×");
    await ctx.close();
  });

  test("@cross the file fallback gives the same preview and the same confirmation", async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, old, before } = await oldAddressWithProgress(browser);
    await old.goto("/transfer/send");
    const [download] = await Promise.all([old.waitForEvent("download"), old.getByTestId("transfer-download").click()]);
    const path = (await download.path())!;
    expect(createReadStream(path)).toBeTruthy();

    const mine = await ctx.newPage();
    await mine.goto(`${TARGET}/transfer/receive`);
    await mine.getByTestId("transfer-file").setInputFiles(path);
    await expect(mine.getByTestId("transfer-preview-text")).toContainText("New to this device: 1 lesson finished");
    expect(await read(mine)).toBeNull();
    await mine.getByTestId("transfer-confirm").click();
    await expect(mine.getByTestId("transfer-done")).toBeVisible();
    expect(await read(old)).toBe(before);
    await mine.goto(`${TARGET}/library`);
    await expect(completed(mine)).toContainText("Completed 1×");
    await ctx.close();
  });

  test("declining ('Not now') adds nothing; a message the learner did not ask for is ignored; a page opened directly cannot send", async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, old, before } = await oldAddressWithProgress(browser);
    const mine = await ctx.newPage();
    await mine.goto(`${TARGET}/transfer/receive`);
    // an unsolicited message, from the page itself (its own origin is not the old address) and before anything was started
    await mine.evaluate(() => window.postMessage({ app: "grammigo", type: "transfer", v: 1, lessons: { version: 2, sessions: [] }, guided: null }, "*"));
    await mine.waitForTimeout(500);
    await expect(mine.getByTestId("transfer-preview")).toHaveCount(0);

    const [popup] = await Promise.all([ctx.waitForEvent("page"), mine.getByTestId("transfer-begin").click()]);
    await mine.evaluate(() => window.postMessage({ app: "grammigo", type: "transfer", v: 1, lessons: { version: 2, sessions: [] }, guided: null }, "*")); // still the wrong sender
    await mine.waitForTimeout(500);
    await expect(mine.getByTestId("transfer-preview")).toHaveCount(0);
    await popup.getByTestId("transfer-send-button").click();
    await expect(mine.getByTestId("transfer-preview")).toBeVisible();
    await mine.getByTestId("transfer-cancel").click();
    expect(await read(mine)).toBeNull();
    expect(await read(old)).toBe(before);

    const direct = await ctx.newPage(); // opened on its own: no opener, so nothing can be sent
    await direct.goto(`${SOURCE}/transfer/send`);
    await expect(direct.getByTestId("transfer-send-button")).toBeDisabled();
    await expect(direct.getByTestId("transfer-no-opener")).toBeVisible();
    await ctx.close();
  });

  test("each page tells you when you are on the wrong address", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${SOURCE}/transfer/receive`);
    await expect(p.getByTestId("transfer-wrong-place")).toBeVisible();
    await p.goto(`${TARGET}/transfer/send`);
    await expect(p.getByTestId("transfer-wrong-place")).toBeVisible();
    await ctx.close();
  });
});
