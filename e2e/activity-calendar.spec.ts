import { expect, test, type Page } from "@playwright/test";
import { emptyState } from "../src/lib/storage/schema";
import { activitySession } from "../src/tests/activity-fixtures";

const NOW = new Date("2026-11-03T20:00:00Z");
const completed = (id: string, at: string) => activitySession(id, Date.parse(at));
test.use({ timezoneId: "America/Los_Angeles" });
async function seed(page: Page, records: ReturnType<typeof activitySession>[], legacy = false) {
  const state = { ...emptyState(), sessions: records }; state.onboarding.status = "skipped";
  await page.addInitScript(({ state, legacy }) => {
    const key = legacy ? "grammigo:v1" : "grammigo:v2";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(legacy ? { version: 1, sessions: state.sessions, activeSessionId: null } : state));
  }, { state, legacy });
  await page.route("**/api/ai/**", r => r.fulfill({ json: { available: false } }));
}

test("@cross monthly completed activity, unique days, keyboard navigation and 360px layout", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.setFixedTime(NOW);
  await seed(page, [
    completed("oct", "2026-10-27T20:00Z"), completed("one", "2026-11-01T20:00Z"), completed("repeat", "2026-11-01T23:00Z"),
    completed("two", "2026-11-02T20:00Z"), completed("today", "2026-11-03T18:00Z"), completed("future", "2026-11-04T20:00Z"),
    activitySession("unfinished", Date.parse("2026-10-31T20:00Z"), "in_progress"), activitySession("abandoned", Date.parse("2026-10-30T20:00Z"), "abandoned"),
  ]);
  await page.goto("/learn"); const calendar = page.getByTestId("activity-calendar");
  await expect(calendar.getByTestId("active-days")).toHaveText("4 days");
  await expect(calendar.getByTestId("current-streak")).toHaveText("3 days");
  await expect(calendar.getByTestId("longest-streak")).toHaveText("3 days");
  await expect(calendar.locator('[data-active="true"]')).toHaveCount(3);
  await expect(calendar.locator('[data-date="2026-11-04"]')).toHaveAttribute("data-active", "false");
  await expect(calendar.getByRole("button", { name: "Next month" })).toBeDisabled();
  await calendar.getByRole("button", { name: "Previous month" }).focus(); await page.keyboard.press("Enter");
  await expect(calendar.getByTestId("calendar-month")).toHaveText("October 2026");
  await expect(calendar.getByRole("button", { name: "Previous month" })).toBeDisabled();
  await expect(calendar.locator('[data-date="2026-10-27"]')).toHaveAttribute("data-active", "true");
  await expect(calendar.locator('[data-date="2026-10-31"]')).toHaveAttribute("data-active", "false");
  await calendar.getByRole("button", { name: "This month" }).click();
  await page.reload(); await expect(calendar.getByTestId("calendar-month")).toHaveText("November 2026");
  await expect(calendar.getByTestId("active-days")).toHaveText("4 days");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await calendar.screenshot({ path: info.outputPath("learning-activity.png") });
});

test("@cross empty calendar counts no unfinished work or future records", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await seed(page, [activitySession("not-finished", null, "in_progress"), completed("future", "2026-12-01T12:00Z")]);
  await page.goto("/learn"); const calendar = page.getByTestId("activity-calendar");
  await expect(calendar.getByTestId("active-days")).toHaveText("0 days");
  await expect(calendar.getByText(/Migo will mark your first active day/)).toBeVisible();
  await expect(calendar.locator('[data-active="true"]')).toHaveCount(0);
  await expect(calendar.getByRole("button", { name: "Next month" })).toBeDisabled();
});

test("@cross historical v1 timestamps stay intact and leap-day activity remains accessible", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await seed(page, [completed("historical-one", "2024-02-28T20:00Z"), completed("historical-two", "2024-02-29T20:00Z")], true);
  await page.goto("/learn"); const calendar = page.getByTestId("activity-calendar");
  await expect(calendar.getByTestId("active-days")).toHaveText("2 days");
  const original = await page.evaluate(() => localStorage.getItem("grammigo:v1"));
  for (let i = 0; i < 40 && await calendar.getByTestId("calendar-month").innerText() !== "February 2024"; i++) await calendar.getByRole("button", { name: "Previous month" }).click();
  await expect(calendar.getByTestId("calendar-month")).toHaveText("February 2024");
  await expect(calendar.locator('[data-date="2024-02-29"]')).toHaveAttribute("data-active", "true");
  await expect(calendar.getByRole("button", { name: "Previous month" })).toBeDisabled();
  await expect(calendar.getByTestId("longest-streak")).toHaveText("2 days");
  expect(await page.evaluate(() => localStorage.getItem("grammigo:v1"))).toBe(original);
});

test("timezone changes reproject historical timestamps without changing saved progress", async ({ page, context }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00Z"));
  await seed(page, [completed("boundary", "2026-11-03T00:30Z")]);
  await page.goto("/learn"); const calendar = page.getByTestId("activity-calendar");
  await expect(calendar.locator('[data-date="2026-11-02"]')).toHaveAttribute("data-active", "true");
  const original = await page.evaluate(() => localStorage.getItem("grammigo:v2"));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Pacific/Kiritimati" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(calendar.locator('[data-date="2026-11-03"]')).toHaveAttribute("data-active", "true");
  await expect(calendar.locator('[data-date="2026-11-02"]')).toHaveAttribute("data-active", "false");
  await expect(calendar.getByText(/Pacific\/Kiritimati/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("grammigo:v2"))).toBe(original);
});

test("@cross local midnight updates the month and expires a missed-day streak", async ({ page }) => {
  const time = new Date("2026-11-01T06:59:50Z"); // October 31, 23:59:50 in Los Angeles.
  await page.clock.install({ time }); await page.clock.pauseAt(time);
  await seed(page, [completed("yesterday", "2026-10-30T19:00Z")]);
  await page.goto("/learn"); const calendar = page.getByTestId("activity-calendar");
  await expect(calendar.getByTestId("calendar-month")).toHaveText("October 2026");
  await expect(calendar.getByTestId("current-streak")).toHaveText("1 day");
  await page.clock.fastForward(10_000);
  await expect(calendar.getByTestId("calendar-month")).toHaveText("November 2026");
  await expect(calendar.getByTestId("current-streak")).toHaveText("0 days");
});
