import { expect, test } from "@playwright/test";
import { LESSON, seedReturningLearner } from "./helpers";

/** The public front page at "/" and the learner's home at "/learn": first-time visitors, returning learners with old bookmarks, deep links. */
test.describe("front page", () => {
  test("@cross shows the public page (all sections, honest copy) and sets no cookies", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Better grammar. Your way." })).toBeVisible();
    for (const name of ["How it works", "Built around how you learn", "About Grammigo", "Questions, answered"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText(/push-to-talk|eight exercise types/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    // Functional navigation can still pass when the CSS pipeline is broken.
    const appearance = await page.locator("h1").evaluate((node) => ({
      font: getComputedStyle(node).fontFamily,
      size: parseFloat(getComputedStyle(node).fontSize),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(appearance.font).toContain("Manrope");
    expect(appearance.size).toBeGreaterThanOrEqual(40);
    expect(appearance.overflow).toBe(false);
  });

  test("the menu works on any screen: links on a wide one, a disclosure on a phone; Get started goes to the learner home", async ({ page, isMobile }) => {
    await page.goto("/");
    if (isMobile) {
      await page.getByTestId("site-menu").locator("summary").click();
      await page.getByTestId("site-menu").getByRole("link", { name: "FAQ" }).click();
    } else {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "FAQ" }).click();
    }
    await expect(page).toHaveURL(/#faq$/);
    await expect(page.getByRole("heading", { level: 2, name: "Questions, answered" })).toBeInViewport();
    await page.getByRole("link", { name: "Get started" }).first().click();
    await expect(page).toHaveURL(/\/(learn|onboarding)$/);
  });

  test("an FAQ answer opens and closes with the keyboard", async ({ page }) => {
    await page.goto("/");
    const first = page.locator("#faq details").first();
    await first.locator("summary").focus();
    await expect(first).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(first).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("open", "");
  });

  test("@cross someone who already practises here, opening the bare address from an old bookmark, goes straight to /learn", async ({ page }) => {
    await seedReturningLearner(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole("link", { name: "Choose another lesson" })).toBeVisible();
  });

  test("deep links and the library are untouched", async ({ page }) => {
    await seedReturningLearner(page);
    await page.goto(`/practice/${LESSON}`);
    await expect(page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ })).toBeVisible();
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Grammar library" })).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("not yet been reviewed by a lawyer");
  });
});
