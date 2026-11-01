import type { BrowserContext, Page } from "@playwright/test";
import { answerCorrectly, answerLessonQuestion, cont, expectQuestion, LESSON, playWholeLesson, startFromHome } from "../e2e/helpers";
import { BASE, createAccount, q, sessionCookies, signInAgain, type Account } from "./helpers";
import { expect, test } from "./fixtures";

const OUTAGE_BASE = `http://localhost:${process.env.E2E_OUTAGE_PORT ?? 3101}`;
const OTHER_LESSON = "a1-articles";

const docs = async (id: string) => (await q("select doc_key, revision, body from public.learner_documents where user_id = $1 order by doc_key", [id])).rows as { doc_key: string; revision: string; body: { sessions: { id: string }[] } }[];
const lessonsDoc = async (id: string) => (await docs(id)).find((d) => d.doc_key === "lessons_v2");
const hasConsent = async (id: string) => (await q("select count(*)::int as n from public.consents where user_id = $1 and kind = 'cloud_storage'", [id])).rows[0].n === 1;

async function signIn(context: BrowserContext, page: Page, a: Account) {
  await context.addCookies(sessionCookies(a));
  await page.goto("/account");
  await expect(page.getByTestId("dashboard-greeting")).toContainText(a.name);
  await expect(page.getByTestId("sync-card")).toBeVisible(); // the sync engine for this learner is running
}

async function finishLesson(page: Page, skill = LESSON) {
  await page.goto(`/practice/${skill}`);
  await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
  await expectQuestion(page, 1);
  await playWholeLesson(page, skill);
  await expect(page).toHaveURL(new RegExp(`/practice/${skill}/complete`));
}

/** Every request the page makes to the sync routes, with its method, status and time. */
function watchSync(page: Page) {
  const seen: { method: string; path: string; status: number | null; ms: number | null }[] = [];
  page.on("requestfinished", async (r) => {
    const p = new URL(r.url()).pathname;
    if (!p.startsWith("/api/sync")) return;
    const res = await r.response();
    const t = r.timing();
    seen.push({ method: r.method(), path: p, status: res?.status() ?? null, ms: t.responseEnd >= 0 ? Math.round(t.responseEnd) : null });
  });
  page.on("requestfailed", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/sync")) seen.push({ method: r.method(), path: p, status: null, ms: null });
  });
  return seen;
}
const puts = (seen: ReturnType<typeof watchSync>) => seen.filter((s) => s.method === "PUT");

test.describe("saving progress needs consent", () => {
  test("a learner who has not agreed: lessons work, NOTHING is uploaded, and they are asked plainly", async ({ context, page }) => {
    test.setTimeout(90_000);
    const ana = await createAccount({ name: "No Consent Ana", learner: true });
    await signIn(context, page, ana);
    const seen = watchSync(page);
    await expect(page.getByTestId("sync-card")).toContainText("Keep my progress in my account");
    await expect(page.getByTestId("sync-card")).toContainText("never audio");
    await expect(page.getByTestId("sync-chip")).toContainText("Progress on this device");

    await finishLesson(page);
    await page.waitForTimeout(8_000); // longer than any checkpoint delay
    expect(seen.filter((s) => s.path.startsWith("/api/sync/documents"))).toEqual([]); // no document was read or written
    expect(puts(seen)).toEqual([]);
    expect(await docs(ana.id)).toEqual([]);
    expect(await hasConsent(ana.id)).toBe(false);
  });

  test("turning saving on records consent FIRST, then saves what was already there, and the chip says so only when it is true", async ({ context, page }) => {
    test.setTimeout(90_000);
    const ana = await createAccount({ name: "Agrees Ana", learner: true });
    await signIn(context, page, ana);
    await finishLesson(page);
    await page.goto("/account");
    await expect(page.getByTestId("sync-chip")).toContainText("Progress on this device");
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await expect.poll(async () => hasConsent(ana.id), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await lessonsDoc(ana.id))?.body.sessions.length, { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId("sync-chip")).toContainText("Saved to your account", { timeout: 20_000 });
    await expect(page.getByTestId("sync-detail")).toContainText(/Last saved/);
  });
});

test.describe("no round trip per answer", () => {
  test("answering makes no sync requests; finishing the lesson makes exactly one save, a few seconds later", async ({ context, page }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Batch Ana", learner: true });
    await signIn(context, page, ana);
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await expect.poll(async () => hasConsent(ana.id), { timeout: 20_000 }).toBe(true);
    await finishLesson(page, LESSON);
    await expect.poll(async () => Number((await lessonsDoc(ana.id))?.revision), { timeout: 20_000 }).toBe(1);

    const seen = watchSync(page);
    await page.goto(`/practice/${OTHER_LESSON}`);
    await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
    await expectQuestion(page, 1);
    for (let n = 1; n <= 7; n++) {
      await expectQuestion(page, n);
      await answerLessonQuestion(page, OTHER_LESSON, n);
      await cont(page);
    }
    // Seven answers. The only request a page load makes is its one start-up check of the account (it has nothing to do with answering);
    // there is no document read or write, and certainly nothing per answer.
    expect(seen.filter((s) => s.path !== "/api/sync/state")).toEqual([]);
    expect(seen.filter((s) => s.path === "/api/sync/state").length).toBeLessThanOrEqual(1);
    await expectQuestion(page, 8);
    await answerLessonQuestion(page, OTHER_LESSON, 8);
    await cont(page);
    await expect(page).toHaveURL(new RegExp(`/practice/${OTHER_LESSON}/complete`));
    await expect.poll(async () => Number((await lessonsDoc(ana.id))?.revision), { timeout: 20_000 }).toBe(2);
    await page.waitForTimeout(2_000);
    expect(puts(seen)).toHaveLength(1); // ONE save for the whole lesson
    expect((await lessonsDoc(ana.id))?.body.sessions).toHaveLength(2);
  });
});

test.describe("a failing or missing network never blocks a lesson", () => {
  async function ready(context: BrowserContext, page: Page, name: string) {
    const ana = await createAccount({ name, learner: true });
    await signIn(context, page, ana);
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await expect.poll(async () => hasConsent(ana.id), { timeout: 20_000 }).toBe(true);
    return ana;
  }

  for (const [label, handler] of [
    ["refused (as if offline)", (r: import("@playwright/test").Route) => r.abort("connectionrefused")],
    ["503 from the server", (r: import("@playwright/test").Route) => r.fulfill({ status: 503, headers: { "retry-after": "30" }, contentType: "application/json", body: '{"error":"unavailable"}' })],
    ["500 from the server", (r: import("@playwright/test").Route) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" })],
  ] as const) {
    test(`sync ${label}: the lesson completes normally, the learner is told the truth, and it saves once the network is back`, async ({ context, page }) => {
      test.setTimeout(120_000);
      const ana = await ready(context, page, `Outage ${label.slice(0, 4)} Ana`);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/sync/**", handler);
      await finishLesson(page);
      await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
      await page.waitForTimeout(6_000);
      expect(await lessonsDoc(ana.id)).toBeUndefined(); // truthfully not saved online

      await page.goto("/account");
      await expect(page.getByTestId("sync-chip")).not.toContainText("Saved to your account");
      await expect(page.getByTestId("sync-chip")).toContainText(/Saved on this device|Offline/);
      await expect(page.getByTestId("dashboard-skills")).toBeVisible(); // the learner's progress is all there

      await page.unroute("**/api/sync/**");
      await page.getByRole("button", { name: "Save now" }).click();
      await expect.poll(async () => (await lessonsDoc(ana.id))?.body.sessions.length, { timeout: 30_000 }).toBe(1);
      await expect(page.getByTestId("sync-chip")).toContainText("Saved to your account", { timeout: 20_000 });
      expect(errors).toEqual([]);
    });
  }

  test("a sync request that NEVER answers: every answer still gets its feedback quickly, and the lesson completes", async ({ context, page }) => {
    test.setTimeout(120_000);
    const ana = await ready(context, page, "Hung Ana");
    await page.route("**/api/sync/**", () => undefined); // the request is accepted and never answered
    await page.goto(`/practice/${LESSON}`);
    await page.getByRole("button", { name: /^(Start Lesson|Continue Lesson)$/ }).click();
    await expectQuestion(page, 1);
    const times: number[] = [];
    for (let n = 1; n <= 8; n++) {
      await expectQuestion(page, n);
      const t0 = Date.now();
      await answerLessonQuestion(page, LESSON, n);
      await expect(page.getByTestId("feedback-chip")).toBeVisible();
      times.push(Date.now() - t0);
      await cont(page);
    }
    await expect(page).toHaveURL(new RegExp(`/practice/${LESSON}/complete`));
    console.log("E2E_HUNG_ANSWER_MS " + JSON.stringify({ max: Math.max(...times), mean: Math.round(times.reduce((a, b) => a + b, 0) / times.length) }));
    expect(Math.max(...times)).toBeLessThan(2_000);
    expect(await lessonsDoc(ana.id)).toBeUndefined();
  });
});

test.describe("a real database outage on the server", () => {
  test.use({ baseURL: OUTAGE_BASE });

  test("the account routes answer 'unavailable' (503, retry later), never 'sign in again'; lessons are completely unaffected", async ({ context, page, request }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Outage Server Ana", learner: true });
    const cookies = sessionCookies(ana).map((c) => ({ ...c, url: OUTAGE_BASE }));
    await context.addCookies([...cookies, { name: "gm-scope", value: ana.id, url: OUTAGE_BASE }]);

    const me = await request.get("/api/account/me");
    expect([me.status(), (await me.json()).error]).toEqual([503, "unavailable"]);
    const st = await request.get("/api/sync/state");
    expect(st.status()).toBe(503);
    expect(Number(st.headers()["retry-after"])).toBeGreaterThan(0);
    expect(st.headers()["cache-control"]).toContain("no-store");
    expect((await request.put("/api/sync/documents/lessons_v2", { data: { expectedRevision: 0, body: {} }, headers: { origin: OUTAGE_BASE, "content-type": "application/json" } })).status()).toBe(503);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const seen = watchSync(page);
    const t0 = Date.now();
    await finishLesson(page);
    const took = Date.now() - t0;
    await expect(page.getByRole("heading", { name: "You did it, amigo!" })).toBeVisible();
    await page.waitForTimeout(4_000);
    console.log("E2E_OUTAGE_LESSON_MS " + took);
    expect(took).toBeLessThan(60_000);
    expect(seen.every((s) => s.status === 503 || s.status === null)).toBe(true); // whatever the app tried, the server said "unavailable"
    expect(errors).toEqual([]);
    // the progress is intact on the device
    await page.goto("/library");
    await expect(page.getByTestId("lesson-card").and(page.locator(`[data-skill="${LESSON}"]`)).getByTestId("completion")).toContainText("Completed 1×");
  });
});

test.describe("adding guest progress needs a clear yes", () => {
  const GUEST = "grammigo:v2";
  const read = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

  test("offered, declined without cost, then added on request: the guest copy is never touched, and it is not offered twice", async ({ context, page }) => {
    test.setTimeout(120_000);
    // a guest starts a lesson (no account)
    await startFromHome(page);
    await answerCorrectly(page, 1);
    await cont(page);
    await expectQuestion(page, 2);
    await page.goto("/");
    const guestRaw = (await read(page, GUEST))!;
    const guestSessionId = (JSON.parse(guestRaw).sessions[0] as { id: string }).id;

    const ana = await createAccount({ name: "Importing Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    await page.goto("/account");
    const card = page.getByTestId("import-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("import-summary")).toContainText("1 in progress");
    await expect(card).toContainText("Only add it if it’s yours");
    await expect(card).toContainText("stays on this device, unchanged");
    // looking at the offer changed nothing, anywhere
    expect(await read(page, GUEST)).toBe(guestRaw);
    expect(await read(page, `${GUEST}:u:${ana.id}`)).toBeNull();
    expect(await docs(ana.id)).toEqual([]);
    expect(await hasConsent(ana.id)).toBe(false);

    // "Not now": still nothing moved
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toHaveCount(0);
    expect(await read(page, `${GUEST}:u:${ana.id}`)).toBeNull();
    expect(await docs(ana.id)).toEqual([]);

    // it comes back next visit (declining is not a permanent no), and now she agrees
    await page.reload();
    await page.getByTestId("import-card").getByRole("button", { name: "Add to my account" }).click();
    await expect(page.getByTestId("import-done")).toBeVisible();
    expect(await read(page, GUEST)).toBe(guestRaw); // the guest's own progress: byte for byte the same
    expect(JSON.parse((await read(page, `${GUEST}:u:${ana.id}`))!).sessions.map((s: { id: string }) => s.id)).toContain(guestSessionId);
    await expect.poll(async () => hasConsent(ana.id), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await lessonsDoc(ana.id))?.body.sessions.map((s) => s.id), { timeout: 20_000 }).toContain(guestSessionId);

    await page.reload();
    await expect(page.getByTestId("import-card")).toHaveCount(0); // not offered again to the same account
    await expect(page.getByTestId("dashboard-continue")).toContainText("Question 2 of 8");
  });

  test("a different learner on the same device is warned, gets nothing from the first learner's account, and uploads nothing without a yes", async ({ context, page }) => {
    test.setTimeout(150_000);
    await startFromHome(page);
    await answerCorrectly(page, 1);
    await cont(page);
    await page.goto("/");
    const guestRaw = (await read(page, GUEST))!;

    const [a, b] = await Promise.all([createAccount({ name: "First Importer", learner: true }), createAccount({ name: "Second Learner", learner: true })]);
    await context.addCookies(sessionCookies(a));
    await page.goto("/account");
    await page.getByTestId("import-card").getByRole("button", { name: "Add to my account" }).click();
    await expect.poll(async () => (await lessonsDoc(a.id))?.body.sessions.length, { timeout: 20_000 }).toBe(1);

    // A signs out; B signs in on the same browser
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await context.addCookies(sessionCookies(b));
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-greeting")).toContainText("Second Learner");
    await expect(page.locator("body")).not.toContainText("First Importer");
    const card = page.getByTestId("import-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("alert")).toContainText("already added to an account on this device");
    // B has none of A's progress, and nothing of B's has been saved anywhere
    expect(await read(page, `${GUEST}:u:${b.id}`)).toBeNull();
    expect(await read(page, `${GUEST}:u:${a.id}`)).toContain('"sessions"'); // A's own folder is intact, and not B's to read
    await page.waitForTimeout(5_000);
    expect(await docs(b.id)).toEqual([]);
    expect(await hasConsent(b.id)).toBe(false);
    expect(await read(page, GUEST)).toBe(guestRaw);
  });
});

test.describe("one account on two devices", () => {
  test("each device finishes a different lesson; both converge on both lessons, and mastery comes from the combined history", async ({ browser }) => {
    test.setTimeout(180_000);
    const ana = await createAccount({ name: "Two Devices Ana", learner: true });
    const phoneCtx = await browser.newContext();
    const laptopCtx = await browser.newContext();
    const phone = await phoneCtx.newPage();
    const laptop = await laptopCtx.newPage();
    await phoneCtx.addCookies(sessionCookies(ana));
    await laptopCtx.addCookies(sessionCookies(await signInAgain(ana)));
    for (const [pg] of [[phone], [laptop]] as const) {
      await pg.goto(`${BASE}/account`);
      await expect(pg.getByTestId("sync-card")).toBeVisible();
    }
    await phone.getByRole("button", { name: "Turn on saving to my account" }).click();
    await expect.poll(async () => hasConsent(ana.id), { timeout: 20_000 }).toBe(true);

    // the laptop signs in with consent already recorded by the account: it needs no second yes to receive and save its own account's progress
    await laptop.goto(`${BASE}/account`);
    await expect(laptop.getByTestId("sync-label")).toBeVisible({ timeout: 20_000 });

    const seenPhone = watchSync(phone);
    const seenLaptop = watchSync(laptop);
    await Promise.all([finishLesson(phone, LESSON), finishLesson(laptop, OTHER_LESSON)]);
    await expect.poll(async () => (await lessonsDoc(ana.id))?.body.sessions.length, { timeout: 40_000 }).toBeGreaterThanOrEqual(1);
    for (const pg of [phone, laptop]) {
      await pg.goto(`${BASE}/account`);
      await pg.getByRole("button", { name: "Save now" }).click();
      await expect(pg.getByTestId("sync-chip")).toContainText("Saved to your account", { timeout: 30_000 });
    }
    for (const pg of [phone, laptop]) {
      await pg.getByRole("button", { name: "Save now" }).click();
      await expect(pg.getByTestId("sync-chip")).toContainText("Saved to your account", { timeout: 30_000 });
    }
    const doc = await lessonsDoc(ana.id);
    expect(doc?.body.sessions).toHaveLength(2);

    // both devices now show BOTH lessons as completed in the library
    for (const pg of [phone, laptop]) {
      await pg.goto(`${BASE}/library`);
      for (const skill of [LESSON, OTHER_LESSON]) {
        await expect(pg.getByTestId("lesson-card").and(pg.locator(`[data-skill="${skill}"]`)).getByTestId("completion")).toContainText("Completed 1×");
      }
    }
    // and neither ever made a request per answer: only a handful of saves in total
    expect(puts(seenPhone).length + puts(seenLaptop).length).toBeLessThan(10);
    await Promise.all([phoneCtx.close(), laptopCtx.close()]);
  });
});

test.describe("account-scoped progress is isolated", () => {
  test("A saves; B signs in on the same browser and saves their own: neither document contains the other's lessons", async ({ context, page }) => {
    test.setTimeout(180_000);
    const [a, b] = await Promise.all([createAccount({ name: "Isolated A", learner: true }), createAccount({ name: "Isolated B", learner: true })]);
    await signIn(context, page, a);
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await finishLesson(page, LESSON);
    await expect.poll(async () => (await lessonsDoc(a.id))?.body.sessions.length, { timeout: 30_000 }).toBe(1);
    const aSession = (await lessonsDoc(a.id))!.body.sessions[0].id;

    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await context.addCookies(sessionCookies(b));
    await page.goto("/account");
    await expect(page.getByTestId("sync-card")).toBeVisible();
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await finishLesson(page, OTHER_LESSON);
    await expect.poll(async () => (await lessonsDoc(b.id))?.body.sessions.length, { timeout: 30_000 }).toBe(1);
    const bDoc = await lessonsDoc(b.id);
    expect(bDoc?.body.sessions.map((s) => s.id)).not.toContain(aSession);
    expect(Number((await lessonsDoc(a.id))?.revision)).toBe(1); // A's document was never touched by B's session
    expect((await lessonsDoc(a.id))?.body.sessions.map((s) => s.id)).toEqual([aSession]);
  });
});

test.describe("measured latency", () => {
  test("saving and checking the account takes well under a second through the whole stack, and the figures are reported", async ({ context, page }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Latency Ana", learner: true });
    await signIn(context, page, ana);
    const seen = watchSync(page);
    await page.getByRole("button", { name: "Turn on saving to my account" }).click();
    await finishLesson(page, LESSON);
    await expect.poll(async () => Number((await lessonsDoc(ana.id))?.revision), { timeout: 30_000 }).toBe(1);
    await page.goto("/account"); // the "Save now" button lives on the dashboard, not on the lesson-complete page
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Save now" }).click({ timeout: 10_000 });
      await expect(page.getByTestId("sync-chip")).toContainText("Saved to your account", { timeout: 10_000 });
    }
    const ms = seen.map((s) => s.ms).filter((x): x is number => typeof x === "number").sort((x, y) => x - y);
    expect(ms.length).toBeGreaterThan(2);
    const p = (q2: number) => ms[Math.min(ms.length - 1, Math.ceil(q2 * ms.length) - 1)];
    console.log("E2E_SYNC_LATENCY_MS " + JSON.stringify({ n: ms.length, p50: p(0.5), p95: p(0.95), max: ms[ms.length - 1] }));
    expect(p(0.95)).toBeLessThan(2_000);
  });
});
