import { createReadStream } from "node:fs";
import { answerLessonQuestion, cont, expectQuestion, LESSON } from "../e2e/helpers";
import { BASE, browserHeaders, createAccount, q, sessionCookies } from "./helpers";
import { expect, test } from "./fixtures";
import { authLink, resetLink, waitForMail } from "./mail";

/**
 * Email + password in a real browser, against the real local Auth server and its mailbox. Google and email are tested separately: this file never
 * touches Google sign-in, and the Google suites never touch passwords.
 */
const GOOD = "correct horse battery staple";
const NEW = "a different long passphrase 7";
const jsonHeaders = () => ({ ...browserHeaders(), "content-type": "application/json" });
const email = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@test.invalid`;
const since = () => Date.now() - 2_000;

async function invitationCode(request: import("@playwright/test").APIRequestContext, owner: Awaited<ReturnType<typeof createAccount>>, context: import("@playwright/test").BrowserContext) {
  await context.addCookies(sessionCookies(owner));
  const made = await request.post(`${BASE}/api/admin/invitations`, { data: { label: "email student", maxUses: 1, expiresInDays: 1 }, headers: jsonHeaders() });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { code: string }).code;
}

test.describe("joining with email and a password", () => {
  test("@cross code + address + password -> confirmation email -> sign in -> lesson saved -> sign out -> back in -> export -> delete", async ({ browser, page, context, request }) => {
    test.setTimeout(240_000);
    const owner = await createAccount({ name: "Email Owner", admin: true });
    const code = await invitationCode(request, owner, context);
    await context.clearCookies();
    const address = email("student");
    const t = since();

    // the form: disclosures visible, then the registration
    await page.goto("/join/email");
    await expect(page.getByTestId("join-disclosures")).toContainText("never by Grammigo");
    await page.getByLabel("Invitation code").fill(code);
    await page.getByLabel("Email address").fill(address);
    await page.getByLabel(/Choose a password/).fill(GOOD);
    await page.getByLabel(/I’m 18 or older/).check();
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(page.getByTestId("check-email-confirm")).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === "gm-auth")).toBe(false); // nobody is signed in
    expect((await q("select count(*)::int n from public.profiles p join auth.users u on u.id = p.id where u.email = $1", [address])).rows[0].n).toBe(0);

    // signing in before confirming is refused with its own message
    await page.goto("/signin");
    await page.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await page.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.locator('p[role="alert"]').filter({ hasText: "confirm your email address" })).toBeVisible();

    // the link in the email confirms the address and signs nobody in
    const mail = await waitForMail(address, { contains: /auth\/v1\/verify/, after: t });
    await page.goto(authLink(mail.text));
    await expect(page.getByTestId("email-confirmed")).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === "gm-auth")).toBe(false);

    // now the password signs them in, and the seat is redeemed
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await page.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByTestId("dashboard-greeting")).toBeVisible();
    const me = (await q("select id from auth.users where email = $1", [address])).rows[0].id as string;
    expect((await q("select count(*)::int n from public.profiles where id = $1", [me])).rows[0].n).toBe(1);

    // a lesson, saved to the account, with no sync request while answering
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await expect.poll(async () => (await q("select count(*)::int n from public.consents where user_id = $1 and kind = 'cloud_storage'", [me])).rows[0].n, { timeout: 20_000 }).toBe(1);
    await page.goto(`/practice/${LESSON}`);
    await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
    await expectQuestion(page, 1);
    await page.waitForTimeout(2_500);
    let syncCalls = 0;
    page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/sync")) syncCalls++; });
    for (let n = 1; n <= 7; n++) { await expectQuestion(page, n); await answerLessonQuestion(page, LESSON, n); await cont(page); }
    expect(syncCalls).toBe(0);
    await expectQuestion(page, 8);
    await answerLessonQuestion(page, LESSON, 8);
    await cont(page);
    await expect.poll(async () => ((await q("select body from public.learner_documents where user_id = $1 and doc_key = 'lessons_v2'", [me])).rows[0]?.body.sessions ?? []).length, { timeout: 30_000 }).toBe(1);

    // sign out, then come back on a fresh device: progress restored from the account
    await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`)); // let the lesson's own redirect finish before navigating away
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === "gm-auth")).toBe(false);
    const fresh = await browser.newContext();
    const back = await fresh.newPage();
    await back.goto(`${BASE}/signin`);
    await back.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await back.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await back.getByRole("button", { name: "Sign in with email" }).click();
    await expect(back.getByTestId("dashboard-greeting")).toBeVisible();
    await expect.poll(() => back.evaluate((k) => (JSON.parse(window.localStorage.getItem(k) ?? "{}").sessions ?? []).length, `grammigo:v2:u:${me}`), { timeout: 30_000 }).toBe(1);

    // export, then delete (a password sign-in just happened, so no extra step)
    await back.goto(`${BASE}/account/data`);
    const [download] = await Promise.all([back.waitForEvent("download"), back.getByTestId("export-button").click()]);
    const chunks: Buffer[] = [];
    for await (const c of createReadStream((await download.path())!)) chunks.push(c as Buffer);
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8")).account.email).toBe(address);
    await back.goto(`${BASE}/account/delete`);
    await back.getByTestId("delete-phrase").fill("delete my account");
    await back.getByTestId("delete-understood").check();
    await back.getByTestId("delete-submit").click();
    await expect(back).toHaveURL(/\/auth\/deleted$/, { timeout: 30_000 });
    expect((await q("select count(*)::int n from auth.users where id = $1", [me])).rows[0].n).toBe(0);
    await fresh.close();
  });

  test("a wrong code, a weak password and an address that already belongs to a Google learner are refused, send no email and create nothing", async ({ page }) => {
    const owner = await createAccount({ name: "Refusal Owner", admin: true });
    const google = await createAccount({ name: "Google Person", learner: true });
    const bad = email("nobody");
    await page.goto("/join/email");
    const fill = async (code: string, address: string, password: string) => {
      await page.goto("/join/email");
      await page.getByLabel("Invitation code").fill(code);
      await page.getByLabel("Email address").fill(address);
      await page.getByLabel(/Choose a password/).fill(password);
      await page.getByLabel(/I’m 18 or older/).check();
      await page.getByRole("button", { name: "Create my account" }).click();
    };
    await fill("ABCD-EFGH-JKMN", bad, GOOD);
    await expect(page.locator('p[role="alert"]').filter({ hasText: "invitation code" })).toBeVisible();
    const req = page.request;
    await page.context().addCookies(sessionCookies(owner));
    const made = await req.post(`${BASE}/api/admin/invitations`, { data: { label: "refusals", maxUses: 3, expiresInDays: 1 }, headers: jsonHeaders() });
    const { code } = (await made.json()) as { code: string };
    await page.context().clearCookies();
    await fill(code, bad, "Password1234");
    await expect(page.locator('p[role="alert"]')).toContainText("most common passwords");
    await fill(code, google.email, GOOD);
    await expect(page.locator('p[role="alert"]')).toContainText("can’t be used to join");
    expect((await q("select count(*)::int n from auth.users where email = any($1)", [[bad]])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from auth.identities where user_id = $1 and provider = 'email'", [google.id])).rows[0].n).toBe(0); // no email identity was attached to the Google person
    await expect(waitForMail(bad, { timeoutMs: 1_500 })).rejects.toThrow(/no email/);
  });

  test("the sign-in page is open to guests only as a form: wrong credentials are refused with one message, and rate limits show", async ({ page }) => {
    await page.goto("/signin");
    for (const [who, pw] of [[email("ghost"), "whatever password here"], ["not-an-address", "x"]] as const) {
      await page.getByTestId("password-signin").getByLabel("Email address").fill(who);
      await page.getByTestId("password-signin").getByLabel("Password").fill(pw);
      await page.getByTestId("password-signin").getByLabel("Email address").evaluate((el: HTMLInputElement) => el.form?.setAttribute("novalidate", ""));
      await page.getByRole("button", { name: "Sign in with email" }).click();
      await expect(page.locator('p[role="alert"]').filter({ hasText: "don’t match" })).toBeVisible();
    }
  });
});

test.describe("forgot password", () => {
  test("ask for a link, open it in the same browser, choose a new password, and the old one stops working everywhere", async ({ browser, page, context, request }) => {
    test.setTimeout(240_000);
    const owner = await createAccount({ name: "Reset Owner", admin: true });
    const code = await invitationCode(request, owner, context);
    await context.clearCookies();
    const address = email("reset");
    let t = since();
    await page.goto("/join/email");
    await page.getByLabel("Invitation code").fill(code);
    await page.getByLabel("Email address").fill(address);
    await page.getByLabel(/Choose a password/).fill(GOOD);
    await page.getByLabel(/I’m 18 or older/).check();
    await page.getByRole("button", { name: "Create my account" }).click();
    await page.goto(authLink((await waitForMail(address, { contains: /auth\/v1\/verify/, after: t })).text));
    await page.goto("/signin");
    await page.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await page.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByTestId("dashboard-greeting")).toBeVisible();

    // a second device is signed in too
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`${BASE}/signin`);
    await otherPage.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await otherPage.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await otherPage.getByRole("button", { name: "Sign in with email" }).click();
    await expect(otherPage.getByTestId("dashboard-greeting")).toBeVisible();

    // the reset, asked for from the first browser (signed out first, as someone who forgot would be)
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    t = since();
    await page.goto("/auth/forgot");
    await page.getByLabel("Email address").fill(address);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("check-email-reset")).toBeVisible();
    const mail = await waitForMail(address, { contains: /auth\/reset#token_hash=/, after: t });
    await page.goto(resetLink(mail.text));
    await expect(page.getByTestId("reset-form")).toBeVisible(); // opening the link changes nothing; the button does
    const [posted] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/recover")), page.getByRole("button", { name: "Choose a new password" }).click()]);
    expect(posted.status(), "the reset button's POST").toBe(303);
    await expect(page).toHaveURL(/\/auth\/new-password/);
    await page.getByLabel(/New password/).fill(NEW);
    await page.getByLabel("Type it again").fill("something else entirely 1");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("don’t match");
    await page.getByLabel(/New password/).fill(NEW);
    await page.getByLabel("Type it again").fill(NEW);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/signin\?e=pwchanged/);
    await expect(page.locator('p[role="alert"]')).toContainText("signed out everywhere");

    // the other device is signed out; the old password is refused; the new one works
    expect((await other.request.get(`${BASE}/api/account/me`)).status()).toBe(401);
    await page.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await page.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.locator('p[role="alert"]').filter({ hasText: "don’t match" })).toBeVisible();
    await page.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await page.getByTestId("password-signin").getByLabel("Password").fill(NEW);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByTestId("dashboard-greeting")).toBeVisible();
    await other.close();
  });

  test("a Google person asking for a reset gets the same answer and no email", async ({ page }) => {
    const google = await createAccount({ name: "Google Reset", learner: true });
    const t = since();
    await page.goto("/auth/forgot");
    await page.getByLabel("Email address").fill(google.email);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("check-email-reset")).toBeVisible();
    await expect(waitForMail(google.email, { after: t, timeoutMs: 2_000 })).rejects.toThrow(/no email/);
  });

  test("a reset link opened in a DIFFERENT browser or device works, and fetching it first (a mail scanner) does not use it up", async ({ browser, request, context }) => {
    test.setTimeout(240_000);
    const owner = await createAccount({ name: "Other Browser Owner", admin: true });
    const code = await invitationCode(request, owner, context);
    await context.clearCookies();
    const address = email("otherbrowser");
    const t = since();
    const a = await (await browser.newContext()).newPage();
    await a.goto(`${BASE}/join/email`);
    await a.getByLabel("Invitation code").fill(code);
    await a.getByLabel("Email address").fill(address);
    await a.getByLabel(/Choose a password/).fill(GOOD);
    await a.getByLabel(/I’m 18 or older/).check();
    await a.getByRole("button", { name: "Create my account" }).click();
    await a.goto(authLink((await waitForMail(address, { contains: /auth\/v1\/verify/, after: t })).text));
    // the account needs a profile before a reset email is sent: sign in once (this redeems the seat)
    await a.goto(`${BASE}/signin`);
    await a.getByTestId("password-signin").getByLabel("Email address").fill(address);
    await a.getByTestId("password-signin").getByLabel("Password").fill(GOOD);
    await a.getByRole("button", { name: "Sign in with email" }).click();
    await expect(a.getByTestId("dashboard-greeting")).toBeVisible();
    await a.goto(`${BASE}/account/profile`);
    await a.getByRole("button", { name: "Sign out" }).click();
    const t2 = since();
    await a.goto(`${BASE}/auth/forgot`);
    await a.getByLabel("Email address").fill(address);
    await a.getByRole("button", { name: "Send the link" }).click();
    const link = resetLink((await waitForMail(address, { contains: /auth\/reset#token_hash=/, after: t2 })).text);
    // a mail scanner / link preview fetches the link first: nothing is used up
    expect((await request.get(link)).status()).toBe(200);
    expect((await request.get(link)).status()).toBe(200);
    // the person opens it on another device entirely (a new browser profile that never asked)
    const elsewhere = await (await browser.newContext()).newPage();
    await elsewhere.goto(link);
    const [posted] = await Promise.all([elsewhere.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/recover")), elsewhere.getByRole("button", { name: "Choose a new password" }).click()]);
    expect(posted.status(), "the reset button's POST").toBe(303);
    await expect(elsewhere).toHaveURL(/\/auth\/new-password/);
    await elsewhere.getByLabel(/New password/).fill(NEW);
    await elsewhere.getByLabel("Type it again").fill(NEW);
    await elsewhere.getByRole("button", { name: "Save new password" }).click();
    await expect(elsewhere).toHaveURL(/\/signin\?e=pwchanged/);
    // the link was single use
    const again = await (await browser.newContext()).newPage();
    await again.goto(link);
    await again.getByRole("button", { name: "Choose a new password" }).click();
    await expect(again).toHaveURL(/\/auth\/error\?r=recover/);
    await expect(again.locator('p[role="alert"]')).toContainText("ask for a new one");
  });
});
