import { expect, test, type Page } from "@playwright/test";
import { PROGRESS_NOW, progressFixture } from "../src/tests/progress-fixtures";
import { answerLessonQuestion, cont, seedReturningLearner } from "./helpers";

async function offline(page: Page) {
  await page.addInitScript(() => localStorage.setItem("grammigo:audio:v1", JSON.stringify({ version:1, muted:true })));
  await page.route("**/api/ai/**", r => r.fulfill({ json:{available:false} }));
}

test("@cross Progress navigation, honest empty state and accessible 360px layout", async ({ page }, info) => {
  await seedReturningLearner(page); await offline(page);
  if (info.project.name === "mobile") await page.setViewportSize({width:360,height:800});
  await page.goto("/learn");
  await page.getByRole("navigation",{name:"Main",exact:true}).filter({visible:true}).getByRole("link",{name:"Progress",exact:true}).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading",{name:"Your progress",exact:true})).toBeVisible();
  await expect(page.getByTestId("progress-completed")).toHaveText("0");
  await expect(page.getByTestId("progress-empty")).toBeVisible();
  await expect(page.getByTestId("progress-placement")).toContainText("No CEFR placement estimate");
  await expect(page.getByRole("navigation",{name:"Main",exact:true}).filter({visible:true}).getByRole("link",{name:"Progress",exact:true})).toHaveAttribute("aria-current","page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("progress-empty.png"),fullPage:true});
});

test("@cross saved evidence, local dates and recommendations agree with Home after reload", async ({ page }, info) => {
  await offline(page); await page.clock.setFixedTime(PROGRESS_NOW);
  const state = progressFixture();
  await page.addInitScript(state => { if (!localStorage.getItem("grammigo:v2")) localStorage.setItem("grammigo:v2",JSON.stringify(state)); },state);
  await page.goto("/learn");
  const reason = await page.getByTestId("next-step-text").innerText();
  const next = await page.getByRole("link",{name:"Start Practice",exact:true}).getAttribute("href");
  await page.goto("/progress");
  await expect(page.getByTestId("progress-completed")).toHaveText("3");
  await expect(page.getByTestId("progress-topics")).toHaveText("4");
  await expect(page.getByTestId("progress-grammar-list")).toContainText("Demonstrated strength");
  await expect(page.getByTestId("progress-grammar-list")).toContainText("Worth reviewing");
  await expect(page.getByTestId("progress-grammar-list")).toContainText("Not enough checked evidence");
  await expect(page.getByTestId("progress-recommendations")).toContainText(reason);
  await expect(page.getByTestId("progress-recommendations").getByRole("link").first()).toHaveAttribute("href",next!);
  const recent = page.getByTestId("progress-recent-list");
  await expect(recent.getByRole("listitem")).toHaveCount(4);
  await expect(recent.locator("time").first()).toHaveAttribute("datetime",new Date(state.sessions[3].completedAt!).toISOString());
  await expect(page.getByText(/Completing a lesson does not demonstrate proficiency/)).toBeVisible();
  await page.screenshot({path:info.outputPath("progress-evidence.png"),fullPage:true});
  await page.reload(); await expect(page.getByTestId("progress-completed")).toHaveText("3");
  await recent.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/practice\/a1-articles\/review\?session=unchecked/);
  await expect(page.getByRole("heading",{name:/review/i}).first()).toBeVisible();
});

test("completing a lesson updates Progress without counting unfinished work", async ({ page }) => {
  await seedReturningLearner(page); await offline(page);
  await page.goto("/practice/a1-be-present");
  await page.getByRole("button",{name:"Start Lesson",exact:true}).click();
  await answerLessonQuestion(page,"a1-be-present",1); await cont(page);
  await page.goto("/progress");
  await expect(page.getByTestId("progress-completed")).toHaveText("0");
  await expect(page.getByTestId("progress-topics")).toHaveText("1");
  await page.getByRole("link",{name:"Continue Lesson",exact:true}).click();
  const count = process.env.E2E_LISTENING === "1" ? 9 : 8;
  for(let n=2;n<=count;n++){await answerLessonQuestion(page,"a1-be-present",n);await cont(page);}
  await page.goto("/progress");
  await expect(page.getByTestId("progress-completed")).toHaveText("1");
  await expect(page.getByTestId("progress-recent-list").getByRole("listitem")).toHaveCount(1);
});

test("@cross historical v1 completions remain available without rewriting the backup", async ({ page }) => {
  await offline(page); await page.clock.setFixedTime(PROGRESS_NOW);
  const history = progressFixture().sessions.slice(0,1);
  const raw = JSON.stringify({version:1,sessions:history,activeSessionId:null});
  await page.addInitScript(raw => { if(!localStorage.getItem("grammigo:v1")) localStorage.setItem("grammigo:v1",raw); },raw);
  await page.goto("/progress");
  await expect(page.getByTestId("progress-completed")).toHaveText("1");
  expect(await page.evaluate(()=>localStorage.getItem("grammigo:v1"))).toBe(raw);
});
