import { BASE, createAccount, sessionCookies } from "./helpers";
import { expect, test } from "./fixtures";
import { emptyState } from "../src/lib/storage/schema";
import { activitySession } from "../src/tests/activity-fixtures";

test("@cross calendar follows the verified learner across account switches and keeps guest history separate", async ({ context, page }) => {
  const a = await createAccount({ name: "Calendar Alpha", learner: true });
  const b = await createAccount({ name: "Calendar Bravo", learner: true });
  const history = (dates: string[]) => ({ ...emptyState(), onboarding: { ...emptyState().onboarding, status: "skipped" as const }, sessions: dates.map((date, i) => activitySession(String(i), Date.parse(date))) });
  const states = {
    "grammigo:v2": history(["2023-01-01T12:00Z", "2023-01-02T12:00Z", "2023-01-03T12:00Z"]),
    [`grammigo:v2:u:${a.id}`]: history(["2024-02-28T12:00Z", "2024-02-29T12:00Z"]),
    [`grammigo:v2:u:${b.id}`]: history(["2024-05-01T12:00Z"]),
  };
  await page.addInitScript(states => { for (const [key, state] of Object.entries(states)) if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, states);
  await context.addCookies([...sessionCookies(a), { name: "gm-scope", value: a.id, url: BASE }]);
  await page.goto("/account");
  const calendar = page.getByTestId("activity-calendar");
  await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Calendar Alpha");
  await expect(calendar.getByTestId("active-days")).toHaveText("2 days");
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await context.clearCookies();
  // Deliberately leave the previous learner's scope; the existing server-verified guard must correct it.
  await context.addCookies([...sessionCookies(b), { name: "gm-scope", value: a.id, url: BASE }]);
  await page.goto("/account");
  await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Calendar Bravo");
  await expect(calendar.getByTestId("active-days")).toHaveText("1 day");
  await page.goto("/learn"); await expect(calendar.getByTestId("active-days")).toHaveText("1 day");
  await context.clearCookies(); await page.goto("/learn");
  await expect(calendar.getByTestId("active-days")).toHaveText("3 days");
  await context.addCookies([...sessionCookies(a), { name: "gm-scope", value: a.id, url: BASE }]);
  await page.goto("/account"); await expect(calendar.getByTestId("active-days")).toHaveText("2 days");
});
