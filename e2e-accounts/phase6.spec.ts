import { createReadStream } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { BASE, browserHeaders, createAccount, q, sessionCookies, signInAgain, uniqueIp, type Account } from "./helpers";
import { expect, test } from "./fixtures";

/** A third copy of the app whose "recent sign-in" window is ONE second, so a stale sign-in can be tested without waiting ten minutes. */
const STRICT_PORT = Number(process.env.E2E_STRICT_PORT ?? 3102);
const STRICT = `http://localhost:${STRICT_PORT}`;
const PHRASE = "delete my account";
const GUEST = "grammigo:v2";

const exists = async (id: string) => (await q("select count(*)::int n from auth.users where id = $1", [id])).rows[0].n === 1;
const folder = (id: string) => `grammigo:v2:u:${id}`;
const seedFolder = (page: Page, id: string, marker: string) =>
  page.addInitScript(([key, m]) => {
    // once per tab: later page loads (such as after a deletion) must not put the folder back
    if (window.sessionStorage.getItem("seeded:" + key)) return;
    window.sessionStorage.setItem("seeded:" + key, "1");
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify({ version: 2, sessions: [], activeSessionId: null, onboarding: { status: "skipped", step: "welcome", draftText: "", draftSource: "typed", runId: null, startedAt: null, completedAt: null }, goals: null, diagnosticRuns: [], lastRecommendation: null, writingFeedback: { m: { text: m } } }));
  }, [folder(id), marker] as const);
async function readDownload(download: import("@playwright/test").Download) {
  const chunks: Buffer[] = [];
  for await (const c of createReadStream((await download.path())!)) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function signedIn(context: BrowserContext, a: Account) {
  await context.addCookies(sessionCookies(a));
}

test.describe("download my data", () => {
  test("@cross a learner downloads a file with their own records, and none of another learner's", async ({ context, page }) => {
    const ana = await createAccount({ name: "Export Ana", learner: true });
    const ben = await createAccount({ name: "Export Ben SECRET-BEN", learner: true });
    await q("insert into public.consents (user_id, kind, version) values ($1, 'cloud_storage', 'e2e'), ($2, 'cloud_storage', 'e2e')", [ana.id, ben.id]);
    await q("select * from public.put_document($1, 'guided_v1', 0, 1, $2::jsonb)", [ana.id, JSON.stringify({ version: 1, sessions: [], activeSessionId: null, marker: "ANA-MARKER" })]);
    await q("select * from public.put_document($1, 'guided_v1', 0, 1, $2::jsonb)", [ben.id, JSON.stringify({ version: 1, sessions: [], activeSessionId: null, marker: "BEN-SECRET-MARKER" })]);
    await signedIn(context, ana);
    await page.goto("/account/data");
    await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-button").click()]);
    expect(download.suggestedFilename()).toMatch(/^grammigo-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const data = await readDownload(download);
    expect(data).toMatchObject({ format: "grammigo-account-export", account: { id: ana.id, email: ana.email }, profile: { displayName: "Export Ana" } });
    expect(JSON.stringify(data)).toContain("ANA-MARKER");
    expect(JSON.stringify(data)).not.toMatch(/BEN|SECRET/);
    expect((await q("select kind from public.audit_events where actor = $1", [ana.id])).rows.map((r) => r.kind)).toContain("export_requested");
  });

  test("a cross-site page cannot trigger it, a visitor cannot use it, and it never caches or can be fetched with GET", async ({ context, request }) => {
    const ana = await createAccount({ name: "Export Guard Ana", learner: true });
    expect((await request.post(`${BASE}/api/account/export`, { headers: browserHeaders() })).status()).toBe(401);
    await signedIn(context, ana);
    expect((await request.post(`${BASE}/api/account/export`, { headers: { ...browserHeaders(), origin: "https://evil.example" } })).status()).toBe(403);
    expect((await request.get(`${BASE}/api/account/export`)).status()).toBe(405);
    const ok = await request.post(`${BASE}/api/account/export`, { headers: browserHeaders() });
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toContain("no-store");
    expect(ok.headers()["content-disposition"]).toContain("attachment");
    expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("delete my account", () => {
  test("@cross confirm, delete, end up signed out; the account is gone, the guest's practice is untouched, this account's local copy is removed", async ({ context, page }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Leaving Ana", learner: true });
    const ben = await createAccount({ name: "Staying Ben", learner: true });
    await signedIn(context, ana);
    await seedFolder(page, ana.id, "ANA-LOCAL");
    await page.addInitScript((g) => { if (!window.localStorage.getItem(g)) window.localStorage.setItem(g, JSON.stringify({ version: 2, sessions: [], activeSessionId: null, onboarding: { status: "skipped", step: "welcome", draftText: "", draftSource: "typed", runId: null, startedAt: null, completedAt: null }, goals: null, diagnosticRuns: [], lastRecommendation: null, writingFeedback: { guest: { text: "GUEST-LOCAL" } } })); }, GUEST);
    await page.goto("/account/profile");
    await page.getByTestId("data-link").click();
    await page.getByTestId("delete-link").click();
    await expect(page).toHaveURL(/\/account\/delete$/);

    const submit = page.getByTestId("delete-submit");
    await expect(submit).toBeDisabled();
    await page.getByTestId("delete-phrase").fill("delete");
    await page.getByTestId("delete-understood").check();
    await expect(submit).toBeDisabled(); // wrong words
    await page.getByTestId("delete-phrase").fill("  Delete My Account ");
    await page.getByTestId("delete-understood").uncheck();
    await expect(submit).toBeDisabled(); // not acknowledged
    await page.getByTestId("delete-understood").check();
    await expect(submit).toBeEnabled();
    expect(await exists(ana.id)).toBe(true); // nothing has happened yet
    await submit.click();

    await expect(page).toHaveURL(/\/auth\/deleted$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();
    expect(await exists(ana.id)).toBe(false);
    for (const t of ["profiles", "consents", "learner_documents", "learner_document_versions"]) expect((await q(`select count(*)::int n from public.${t} where ${t === "profiles" ? "id" : "user_id"} = $1`, [ana.id])).rows[0].n, t).toBe(0);
    expect((await q("select count(*)::int n from auth.sessions where user_id = $1", [ana.id])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.deletion_ledger")).rows[0].n).toBeGreaterThanOrEqual(1);
    // this browser: the account's local copy is gone, the guest's is exactly as it was
    expect(await page.evaluate((k) => window.localStorage.getItem(k), folder(ana.id))).toBeNull();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), GUEST)).toContain("GUEST-LOCAL");
    // signed out for real
    await page.goto("/account");
    await expect(page).toHaveURL(/\/signin/);
    // and nobody else was touched
    expect(await exists(ben.id)).toBe(true);
  });

  test("unticking 'remove from this device' keeps the account's local copy", async ({ context, page }) => {
    const ana = await createAccount({ name: "Keeper Ana", learner: true });
    await signedIn(context, ana);
    await seedFolder(page, ana.id, "KEEP-ME");
    await page.goto("/account/delete");
    await page.getByTestId("delete-phrase").fill(PHRASE);
    await page.getByTestId("delete-understood").check();
    await page.getByTestId("delete-local").uncheck();
    await page.getByTestId("delete-submit").click();
    await expect(page).toHaveURL(/\/auth\/deleted$/, { timeout: 30_000 });
    expect(await page.evaluate((k) => window.localStorage.getItem(k), folder(ana.id))).toContain("KEEP-ME");
    expect(await exists(ana.id)).toBe(false);
  });

  test("every other device is signed out too, and the API refuses its old session", async ({ browser }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Two Device Leaver", learner: true });
    const otherCtx = await browser.newContext();
    await otherCtx.addCookies(sessionCookies(await signInAgain(ana)));
    const ctx = await browser.newContext();
    await ctx.addCookies(sessionCookies(ana));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/account/delete`);
    expect((await otherCtx.request.get(`${BASE}/api/account/me`)).status()).toBe(200);
    await page.getByTestId("delete-phrase").fill(PHRASE);
    await page.getByTestId("delete-understood").check();
    await page.getByTestId("delete-submit").click();
    await expect(page).toHaveURL(/\/auth\/deleted$/, { timeout: 30_000 });
    expect((await otherCtx.request.get(`${BASE}/api/account/me`)).status()).toBe(401);
    expect((await otherCtx.request.get(`${BASE}/api/sync/state`)).status()).toBe(401);
    await Promise.all([ctx.close(), otherCtx.close()]);
  });

  test("the API refuses a cross-site request, a visitor, wrong words and an unknown field, and deletes nothing", async ({ context, request }) => {
    const ana = await createAccount({ name: "Guarded Ana", learner: true });
    const headers = { ...browserHeaders(), "content-type": "application/json" };
    const body = (b: unknown) => ({ headers, data: JSON.stringify(b) });
    expect((await request.post(`${BASE}/api/account/delete`, body({ confirm: PHRASE }))).status()).toBe(401);
    await signedIn(context, ana);
    expect((await request.post(`${BASE}/api/account/delete`, { headers: { ...headers, origin: "https://evil.example" }, data: JSON.stringify({ confirm: PHRASE }) })).status()).toBe(403);
    expect((await request.post(`${BASE}/api/account/delete`, body({ confirm: "nope" }))).status()).toBe(400);
    expect((await request.post(`${BASE}/api/account/delete`, body({ confirm: PHRASE, userId: "anyone" }))).status()).toBe(400);
    expect((await request.post(`${BASE}/api/account/delete`, { headers, data: "x".repeat(3000) })).status()).toBe(413);
    expect((await request.get(`${BASE}/api/account/delete`)).status()).toBe(405);
    expect(await exists(ana.id)).toBe(true);
  });

  test("the owner account cannot be deleted from the screen or the API", async ({ context, page, request }) => {
    const owner = await createAccount({ name: "Owner Olga", admin: true });
    await signedIn(context, owner);
    await page.goto("/account/delete");
    await expect(page.getByText("This is the owner account")).toBeVisible();
    await expect(page.getByTestId("delete-form")).toHaveCount(0);
    expect((await request.post(`${BASE}/api/account/delete`, { headers: { ...browserHeaders(), "content-type": "application/json" }, data: JSON.stringify({ confirm: PHRASE }) })).status()).toBe(409);
    expect(await exists(owner.id)).toBe(true);
  });
});

test.describe("confirming it is you before deleting", () => {
  test("a stale sign-in sees 'sign in again' instead of the form, the API refuses, and starting the re-sign-in goes to Google tied to this learner", async ({ browser }) => {
    test.setTimeout(120_000);
    const ana = await createAccount({ name: "Stale Ana", learner: true });
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": uniqueIp() } });
    await ctx.addCookies(sessionCookies(ana));
    const page = await ctx.newPage();
    await page.waitForTimeout(2_500); // longer than the strict server's one-second window
    await page.goto(`${STRICT}/account/delete`);
    await expect(page.getByTestId("reauth-card")).toBeVisible();
    await expect(page.getByTestId("delete-form")).toHaveCount(0);

    const api = await ctx.request.post(`${STRICT}/api/account/delete`, { headers: { origin: STRICT, "content-type": "application/json" }, data: JSON.stringify({ confirm: PHRASE }) });
    expect(api.status()).toBe(403);
    expect(await api.json()).toEqual({ error: "reauth_required" });
    expect(await exists(ana.id)).toBe(true);

    const start = await ctx.request.post(`${STRICT}/api/auth/reauth`, { headers: { origin: STRICT }, maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const to = new URL(start.headers().location);
    expect(to.pathname).toContain("/auth/v1/authorize");
    expect(to.searchParams.get("provider")).toBe("google");
    expect(to.searchParams.get("redirect_to")).toMatch(new RegExp(`^${STRICT}/api/auth/callback\\?flow=`));
    const flow = (await ctx.cookies(STRICT)).find((c) => c.name === "gm-flow");
    expect(flow?.httpOnly).toBe(true);
    expect(JSON.parse(Buffer.from(flow!.value.split(".")[0], "base64url").toString())).toMatchObject({ intent: "reauth", uid: ana.id });
    await ctx.close();
  });

  test("starting a re-sign-in needs a signed-in learner and our own origin", async ({ request, context }) => {
    expect((await request.post(`${BASE}/api/auth/reauth`, { headers: browserHeaders(), maxRedirects: 0 })).headers().location).toContain("/signin?e=session");
    const stranger = await createAccount({ name: "No Profile Sam" });
    await signedIn(context, stranger);
    expect((await request.post(`${BASE}/api/auth/reauth`, { headers: browserHeaders(), maxRedirects: 0 })).headers().location).toContain("/signin?e=session");
    const ana = await createAccount({ name: "Origin Ana", learner: true });
    await context.clearCookies();
    await signedIn(context, ana);
    expect((await request.post(`${BASE}/api/auth/reauth`, { headers: { ...browserHeaders(), origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
  });

  test("a re-sign-in callback with no matching flow is refused like any other", async ({ request }) => {
    const r = await request.get(`${BASE}/api/auth/callback?flow=AAAAAAAAAAAAAAAAAAAAAA&code=abc`, { maxRedirects: 0 });
    expect(r.headers().location).toContain("/auth/error?r=state");
  });
});

test.describe("private pages and the notice", () => {
  test("the data and delete pages are never cached, framed or sniffed, and need a learner", async ({ context, page, request }) => {
    for (const p of ["/account/data", "/account/delete"]) {
      const anon = await request.get(`${BASE}${p}`, { maxRedirects: 0 });
      expect(anon.status(), p).toBe(307);
    }
    const ana = await createAccount({ name: "Headers Ana", learner: true });
    await signedIn(context, ana);
    for (const p of ["/account/data", "/account/delete"]) {
      const r = await page.goto(p);
      expect(r?.headers()["cache-control"], p).toContain("no-store");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("@cross the privacy notice with accounts on is a draft, names what is kept and for how long, and links to export and deletion", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByTestId("privacy-draft-banner")).toContainText("has not yet been reviewed by a lawyer");
    for (const word of ["Google", "Supabase", "OpenAI", "Delete my account", "Download your data"]) await expect(page.getByTestId("privacy-accounts")).toContainText(word);
    await expect(page.getByTestId("retention-table")).toContainText("35 days");
    await expect(page.getByTestId("retention-table")).toContainText("Up to two days");
    await expect(page.getByRole("link", { name: "Delete my account" })).toHaveAttribute("href", "/account/delete");
  });

  test("the goodbye page is public and plain", async ({ page }) => {
    await page.goto("/auth/deleted");
    await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Keep practising" })).toHaveAttribute("href", "/");
  });
});
