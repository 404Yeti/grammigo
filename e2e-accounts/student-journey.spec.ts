import { createReadStream } from "node:fs";
import { answerLessonQuestion, cont, expectQuestion, LESSON } from "../e2e/helpers";
import { BASE, browserHeaders, createAccount, q, sessionCookies, signInAgain } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * The whole first-student journey, as one test, on the real local stack:
 *   owner makes an invitation -> student enters the code (real reservation, real redirect to Google) -> [Google step] -> redeemed -> profile ->
 *   lesson (no database call per answer) -> saving on -> sync -> sign out -> a brand-new device signs in -> progress restored from the account ->
 *   export -> delete.
 * The ONE step this cannot run is Google's own consent screen and code exchange; that is the manual acceptance run with real disposable Google
 * accounts (docs/ops/activation-checklist.md). Everything either side of it is the production code and the real database.
 */
const jsonHeaders = () => ({ ...browserHeaders(), "content-type": "application/json" });
const SYNC = /\/api\/sync\//;

test("invitation -> Google hand-off -> profile -> lesson -> sync -> sign out -> return on a fresh device -> progress restored -> export -> delete", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createAccount({ name: "Journey Owner", admin: true });
  const ownerCtx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.77" } });
  await ownerCtx.addCookies(sessionCookies(owner));

  // 1. the owner creates a one-seat invitation (the real owner API); the full code is returned once
  const made = await ownerCtx.request.post(`${BASE}/api/admin/invitations`, { data: { label: "First student", maxUses: 1, expiresInDays: 1 }, headers: jsonHeaders() });
  expect(made.status()).toBe(201);
  const { id: invitationId, code } = (await made.json()) as { id: string; code: string };
  expect(code).toMatch(/^[A-Z2-9-]{8,}$/);
  expect((await (await ownerCtx.request.get(`${BASE}/api/admin/invitations`)).text())).not.toContain(code.replace(/-/g, "")); // never listed again in full

  // 2. the student opens the join page (disclosures shown) and submits the code: a real seat is reserved and the browser is sent to Google
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.78" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/join`);
  await expect(page.getByTestId("join-disclosures")).toContainText("never your password");
  await expect(page.getByTestId("join-disclosures")).toContainText("draft");
  const start = await ctx.request.post(`${BASE}/api/auth/join`, { form: { code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const to = new URL(start.headers().location);
  expect(to.pathname).toContain("/auth/v1/authorize");
  expect(to.searchParams.get("provider")).toBe("google");
  const reservation = (await q("select grant_id, status from public.invitation_reservations where invitation_id = $1", [invitationId])).rows;
  expect(reservation.map((r) => r.status)).toEqual(["reserved"]);

  // 3. [Google step: replaced by the identity Google would hand back] the callback's own database step redeems the seat for this person
  const student = await createAccount({ name: "Journey Student" }); // a verified Google identity with NO profile yet: access is still refused
  await ctx.addCookies(sessionCookies(student));
  expect((await ctx.request.get(`${BASE}/api/account/me`)).status()).toBe(403);
  const redeemed = (await q("select public.redeem_invitation($1, $2, $3, now(), 'e2e') as r", [reservation[0].grant_id, student.id, "Journey Student"])).rows[0].r;
  expect(redeemed).toBe("ok");
  expect((await ctx.request.get(`${BASE}/api/account/me`)).status()).toBe(200);
  // the code cannot be used by anyone else now
  const second = await ownerCtx.request.post(`${BASE}/api/auth/join`, { form: { code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
  expect(second.headers().location).toBe(`${BASE}/join?e=full`);

  // 4. the dashboard greets them; they edit their profile
  await page.goto(`${BASE}/account?welcome=1`);
  await expect(page.getByTestId("dashboard-greeting")).toContainText("Journey Student");
  await page.goto(`${BASE}/account/profile/edit`);
  await page.getByLabel("Display name").fill("Journey Student Two");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("profile-name")).toHaveText("Journey Student Two");

  // 5. a lesson. Turn saving on first. Nothing goes to the account while answering; the save follows the finished lesson
  await page.goto(`${BASE}/account`);
  await page.getByRole("button", { name: "Turn on saving to my account" }).click();
  await expect.poll(async () => (await q("select count(*)::int n from public.consents where user_id = $1 and kind = 'cloud_storage'", [student.id])).rows[0].n, { timeout: 20_000 }).toBe(1);
  await page.goto(`${BASE}/practice/${LESSON}`);
  await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
  await expectQuestion(page, 1);
  await page.waitForTimeout(2_500); // let the page's one status check pass
  let syncRequests = 0;
  page.on("request", (r) => { if (SYNC.test(new URL(r.url()).pathname + "/")) syncRequests++; });
  for (let n = 1; n <= 7; n++) {
    await expectQuestion(page, n);
    await answerLessonQuestion(page, LESSON, n);
    await cont(page);
  }
  expect(syncRequests, "no sync request while answering questions 1 to 7").toBe(0);
  await expectQuestion(page, 8);
  await answerLessonQuestion(page, LESSON, 8);
  await cont(page);
  await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
  await expect.poll(async () => ((await q("select body from public.learner_documents where user_id = $1 and doc_key = 'lessons_v2'", [student.id])).rows[0]?.body.sessions ?? []).map((s: { status: string }) => s.status), { timeout: 30_000 }).toEqual(["completed"]);
  expect(syncRequests).toBeGreaterThan(0); // the finished lesson DID cause a save, afterwards

  // 6. sign out (the real button): this device returns to the guest, and shows none of the student's progress
  await page.goto(`${BASE}/account/profile`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${BASE}/library`);
  await expect(page.getByTestId("lesson-card").and(page.locator(`[data-skill="${LESSON}"]`)).getByTestId("completion")).not.toContainText("Completed");
  await ctx.close();

  // 7. they come back on a BRAND NEW device (empty browser storage), sign in, and their progress is restored from the account
  const fresh = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.79" } });
  await fresh.addCookies(sessionCookies(await signInAgain(student)));
  const back = await fresh.newPage();
  await back.goto(`${BASE}/account`);
  await expect(back.getByTestId("dashboard-greeting")).toContainText("Journey Student Two");
  // (nothing to press: the first visit on a device checks the account by itself)
  await expect.poll(() => back.evaluate((k) => (JSON.parse(window.localStorage.getItem(k) ?? "{}").sessions ?? []).length, `grammigo:v2:u:${student.id}`), { timeout: 30_000 }).toBe(1);
  await back.goto(`${BASE}/library`);
  await expect(back.getByTestId("lesson-card").and(back.locator(`[data-skill="${LESSON}"]`)).getByTestId("completion")).toContainText("Completed 1×");

  // 8. they download their data: it holds their lesson and nobody else's
  await back.goto(`${BASE}/account/data`);
  const [download] = await Promise.all([back.waitForEvent("download"), back.getByTestId("export-button").click()]);
  const chunks: Buffer[] = [];
  for await (const c of createReadStream((await download.path())!)) chunks.push(c as Buffer);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.account.id).toBe(student.id);
  expect(JSON.stringify(exported)).toContain("Journey Student Two");
  expect(JSON.stringify(exported)).not.toContain(owner.id);

  // 9. and delete the account (clean-up and the last part of the journey)
  await back.goto(`${BASE}/account/delete`);
  await back.getByTestId("delete-phrase").fill("delete my account");
  await back.getByTestId("delete-understood").check();
  await back.getByTestId("delete-submit").click();
  await expect(back).toHaveURL(/\/auth\/deleted$/, { timeout: 30_000 });
  expect((await q("select count(*)::int n from auth.users where id = $1", [student.id])).rows[0].n).toBe(0);
  await Promise.all([fresh.close(), ownerCtx.close()]);
});
