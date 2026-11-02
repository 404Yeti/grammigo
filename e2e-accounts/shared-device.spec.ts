import { answerCorrectly, cont, expectQuestion, LESSON, startFromHome } from "../e2e/helpers";
import { BASE, createAccount, sessionCookies, signInAgain, type Account } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * One browser, three people: a guest who has started a lesson, then Student A, then Student B (signing in and out in turn).
 * Everything goes through the real pages and the real server sign-out.
 */
const GUEST_KEY = "grammigo:v2";
const scopedKey = (a: Account) => `${GUEST_KEY}:u:${a.id}`;
const read = (page: import("@playwright/test").Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

async function signOut(page: import("@playwright/test").Page) {
  await page.goto("/account/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${BASE}/learn`);
}

test.describe("shared device", () => {
  test("A signs out and B signs in: nobody sees anybody else's progress, and the guest's progress is never touched", async ({ context, page }) => {
    const [a, b] = await Promise.all([createAccount({ name: "Student Alpha", learner: true }), createAccount({ name: "Student Bravo", learner: true })]);

    // 1. a guest starts a lesson (no account needed) and answers the first question
    await startFromHome(page);
    await answerCorrectly(page, 1);
    await cont(page);
    await expectQuestion(page, 2);
    await page.goto("/learn");
    await expect(page.getByTestId("next-step-text")).toContainText("question 2 of 8");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible(); // a plain way in, never a requirement
    const guestRaw = await read(page, GUEST_KEY);
    expect(guestRaw).toContain(LESSON);

    // 2. Student A signs in on this browser: sees a brand-new account, NOT the guest's lesson
    await context.addCookies(sessionCookies(a));
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Student Alpha");
    await expect(page.getByTestId("dashboard-new")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Continue where you left off");
    expect(await read(page, GUEST_KEY)).toBe(guestRaw); // guest progress: not deleted, not overwritten
    expect(await read(page, scopedKey(a))).toBeNull(); // and not imported into A
    expect((await context.cookies()).find((c) => c.name === "gm-scope")?.value).toBe(a.id);
    await page.goto("/library");
    await expect(page.getByRole("link", { name: "Account" })).toBeVisible();

    // 3. A practises: three questions of their own
    await page.goto(`/practice/${LESSON}`);
    await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
    await expectQuestion(page, 1);
    for (const n of [1, 2, 3]) {
      await answerCorrectly(page, n);
      await cont(page);
    }
    await expectQuestion(page, 4);
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-continue")).toContainText("Question 4 of 8");
    const aRaw = await read(page, scopedKey(a));
    expect(aRaw).toContain(LESSON);
    expect(await read(page, GUEST_KEY)).toBe(guestRaw); // still the guest's, byte for byte

    // 4. A signs out: the guest has exactly their own progress back
    await signOut(page);
    expect((await context.cookies()).some((c) => c.name === "gm-scope")).toBe(false);
    await expect(page.getByTestId("next-step-text")).toContainText("question 2 of 8");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect(await read(page, GUEST_KEY)).toBe(guestRaw);

    // 5. Student B signs in: sees neither A's lesson nor the guest's
    await context.addCookies(sessionCookies(b));
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Student Bravo");
    await expect(page.getByTestId("dashboard-new")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Continue where you left off");
    await expect(page.locator("body")).not.toContainText("Student Alpha");
    expect(await read(page, scopedKey(b))).toBeNull(); // nothing was imported into B
    expect(await read(page, scopedKey(a))).toBe(aRaw); // A's progress was not touched while B was here
    expect(await read(page, GUEST_KEY)).toBe(guestRaw);

    // 6. B signs out, A signs back in: A's progress is exactly as A left it
    await signOut(page);
    await context.addCookies(sessionCookies(await signInAgain(a))); // sign-out ended A's session, so A signs in afresh
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-continue")).toContainText("Question 4 of 8");
    expect(await read(page, scopedKey(a))).toBe(aRaw);
    expect(await read(page, GUEST_KEY)).toBe(guestRaw);
  });

  test("a browser still pointed at A's progress cannot show it to B, even when the sign-out cookie was lost", async ({ context, page }) => {
    const [a, b] = await Promise.all([createAccount({ name: "Left Over Alpha", learner: true }), createAccount({ name: "Arriving Bravo", learner: true })]);
    await context.addCookies([...sessionCookies(a), { name: "gm-scope", value: a.id, url: BASE }]);
    await page.goto(`/practice/${LESSON}`);
    await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
    await answerCorrectly(page, 1);
    await cont(page);
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-continue")).toBeVisible();

    // B arrives with a valid session of their own, but the browser still carries A's hint
    await context.clearCookies();
    await context.addCookies([...sessionCookies(b), { name: "gm-scope", value: a.id, url: BASE }]);
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Arriving Bravo");
    await expect(page.getByTestId("dashboard-new")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Continue where you left off");
    await expect(page.locator("body")).not.toContainText("Left Over Alpha");
    expect((await context.cookies()).find((c) => c.name === "gm-scope")?.value).toBe(b.id); // re-pointed to B
  });

  test("learning keeps working with the account system doing nothing: no request to any account endpoint while answering", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    await startFromHome(page);
    for (const n of [1, 2, 3, 4]) {
      await answerCorrectly(page, n);
      await cont(page);
    }
    await expectQuestion(page, 5);
    expect(requests.filter((p) => p.startsWith("/api/account") || p.startsWith("/api/auth") || p.startsWith("/api/admin"))).toEqual([]);
  });
});
