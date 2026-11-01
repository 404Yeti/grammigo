import { seedReturningLearner } from "../e2e/helpers";
import { BASE, browserHeaders, createAccount, q, sessionCookies, uniqueIp } from "./helpers";
import { expect, test } from "./fixtures";

const ip = () => ({ "x-real-ip": uniqueIp() });
const jsonHeaders = () => ({ ...browserHeaders(), "content-type": "application/json" });
const PATCH_OK = { displayName: "Via API", firstLanguage: null, practising: [], dailyMinutes: 10 };

test.describe("the learner dashboard and profile", () => {
  test("a brand-new learner gets one clear first step, and progress is labelled as on this device", async ({ context, page }) => {
    const ana = await createAccount({ name: "Newcomer Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    const res = await page.goto("/account");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, Newcomer Ana");
    await expect(page.getByText("Progress on this device")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Let’s find your starting point" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start the quick check" })).toHaveAttribute("href", "/onboarding");
    await expect(page.locator("body")).not.toContainText(/saved to your account/i);
  });

  test("a returning learner sees their own next step, skills and the honest caveat", async ({ context, page }) => {
    const ana = await createAccount({ name: "Returning Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    await seedReturningLearner(page);
    await page.goto("/account");
    await expect(page.getByTestId("dashboard-next")).toContainText("YOUR NEXT STEP");
    await expect(page.getByTestId("dashboard-skills")).toBeVisible();
    await expect(page.getByTestId("dashboard-caveat")).toContainText("not in your account yet");
    await expect(page.getByTestId("guided-activity")).toHaveCount(0); // no activity, no card
  });

  test("the profile page shows the learner's own details, and nobody else's", async ({ context, page }) => {
    const ana = await createAccount({ name: "Profile Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    await page.goto("/account/profile");
    await expect(page.getByTestId("profile-name")).toHaveText("Profile Ana");
    await expect(page.getByTestId("profile-email")).toHaveText(ana.email);
    await expect(page.getByText(/Member since/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manage invitations" })).toHaveCount(0); // not an owner
  });

  test("a learner edits name, language, topics and daily time; it persists and shows on the dashboard", async ({ context, page }) => {
    const ana = await createAccount({ name: "Before Name", learner: true });
    await context.addCookies(sessionCookies(ana));
    await page.goto("/account/profile/edit");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing to save yet
    await page.getByLabel("Display name").fill("After Name");
    await page.getByLabel("First language (optional)").fill("Portuguese");
    await page.getByRole("button", { name: "Conditionals" }).click();
    await page.getByRole("radio", { name: "15 minutes or more" }).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/account\/profile\?saved=1$/);
    await expect(page.getByTestId("profile-saved")).toBeVisible();
    await expect(page.getByTestId("profile-name")).toHaveText("After Name");
    await expect(page.getByTestId("profile-practising")).toHaveText("Conditionals");
    await expect(page.getByTestId("profile-minutes")).toHaveText("About 15 minutes");

    const row = (await q("select display_name, first_language, preferences, status from public.profiles where id = $1", [ana.id])).rows[0];
    expect(row).toMatchObject({ display_name: "After Name", first_language: "Portuguese", status: "active", preferences: { v: 1, practising: ["Conditionals"], dailyMinutes: 15 } });

    await page.goto("/account");
    await expect(page.getByTestId("dashboard-greeting")).toHaveText("Hi, After Name");
  });

  test("the server's validation reaches the learner in plain words and nothing is saved", async ({ context, page }) => {
    const ana = await createAccount({ name: "Validate Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    await page.goto("/account/profile/edit");
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Please enter a name.")).toBeVisible();
    await expect(page).toHaveURL(/\/account\/profile\/edit$/);
    expect((await q("select display_name from public.profiles where id = $1", [ana.id])).rows[0].display_name).toBe("Validate Ana");
  });
});

test.describe("unauthorized profile access", () => {
  test("anonymous callers: 401 from the API, redirected from the pages", async ({ request, page }) => {
    expect((await request.get("/api/account/profile", { headers: ip() })).status()).toBe(401);
    expect((await request.patch("/api/account/profile", { data: PATCH_OK, headers: jsonHeaders() })).status()).toBe(401);
    for (const path of ["/account/profile", "/account/profile/edit", "/account/invitations"]) {
      const res = await request.get(path, { headers: ip(), maxRedirects: 0 });
      expect([path, res.status()]).toEqual([path, 307]);
    }
    await page.goto("/account/profile");
    await expect(page).toHaveURL(/\/signin\?e=session$/);
  });

  test("an uninvited Google identity: 403 from the API, no profile created, redirected from the pages", async ({ context, request, page }) => {
    const stranger = await createAccount({ name: "Uninvited Person" });
    await context.addCookies(sessionCookies(stranger));
    expect((await request.get("/api/account/profile", { headers: ip() })).status()).toBe(403);
    expect((await request.patch("/api/account/profile", { data: PATCH_OK, headers: jsonHeaders() })).status()).toBe(403);
    expect((await q("select count(*)::int as n from public.profiles where id = $1", [stranger.id])).rows[0].n).toBe(0);
    for (const path of ["/account/profile", "/account/profile/edit", "/account/invitations", "/account"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/auth\/no-account$/);
      await expect(page.locator("body")).not.toContainText("Uninvited Person");
    }
  });

  test("a cross-site request cannot edit a profile, even with the learner's cookie", async ({ context, request }) => {
    const ana = await createAccount({ name: "Csrf Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    const res = await request.patch("/api/account/profile", { data: PATCH_OK, headers: { "content-type": "application/json", origin: "https://evil.example", "x-real-ip": uniqueIp() } });
    expect(res.status()).toBe(403);
    const none = await request.patch("/api/account/profile", { data: PATCH_OK, headers: { "content-type": "application/json", "x-real-ip": uniqueIp() } });
    expect(none.status()).toBe(403);
    expect((await q("select display_name from public.profiles where id = $1", [ana.id])).rows[0].display_name).toBe("Csrf Ana");
  });

  test("requests that try to set privileged or identity fields are refused and change nothing", async ({ context, request }) => {
    const ana = await createAccount({ name: "Escalating Ana", learner: true });
    const bob = await createAccount({ name: "Bystander Bob", learner: true });
    await context.addCookies(sessionCookies(ana));
    const before = (await q("select * from public.profiles where id = any($1)", [[ana.id, bob.id]])).rows;
    for (const extra of [{ id: bob.id }, { userId: bob.id }, { status: "suspended" }, { adult_confirmed_at: "2000-01-01" }, { isAdmin: true }]) {
      expect((await request.patch("/api/account/profile", { data: { ...PATCH_OK, ...extra }, headers: jsonHeaders() })).status(), JSON.stringify(extra)).toBe(400);
    }
    expect((await q("select * from public.profiles where id = any($1)", [[ana.id, bob.id]])).rows).toEqual(before);
    expect((await q("select count(*)::int as n from public.app_admins where user_id = $1", [ana.id])).rows[0].n).toBe(0);
  });

  test("an oversized or malformed body is refused", async ({ context, request }) => {
    const ana = await createAccount({ name: "Large Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    expect((await request.patch("/api/account/profile", { data: { ...PATCH_OK, displayName: "x".repeat(6000) }, headers: jsonHeaders() })).status()).toBe(413);
    expect((await request.patch("/api/account/profile", { data: "not json", headers: jsonHeaders() })).status()).toBe(400);
  });
});

test.describe("cross-account isolation of the dashboard and profile", () => {
  test("two learners each see only themselves; editing one never touches the other", async ({ browser }) => {
    const [a, b] = await Promise.all([createAccount({ name: "Isolated Alpha", learner: true }), createAccount({ name: "Isolated Bravo", learner: true })]);
    const [ca, cb] = await Promise.all([browser.newContext(), browser.newContext()]);
    await ca.addCookies(sessionCookies(a));
    await cb.addCookies(sessionCookies(b));
    const [pa, pb] = [await ca.newPage(), await cb.newPage()];
    for (const path of ["/account", "/account/profile", "/account/profile/edit"]) {
      await pa.goto(`${BASE}${path}`);
      await pb.goto(`${BASE}${path}`);
      await expect(pa.locator("body"), path).not.toContainText("Bravo");
      await expect(pb.locator("body"), path).not.toContainText("Alpha");
      await expect(pa.locator("body"), path).not.toContainText(b.email);
      await expect(pb.locator("body"), path).not.toContainText(a.email);
    }
    const bBefore = (await q("select * from public.profiles where id = $1", [b.id])).rows[0];
    const edit = await ca.request.patch(`${BASE}/api/account/profile`, { data: { ...PATCH_OK, displayName: "Alpha Edited" }, headers: jsonHeaders() });
    expect(edit.status()).toBe(200);
    expect((await q("select * from public.profiles where id = $1", [b.id])).rows[0]).toEqual(bBefore);
    expect(await (await cb.request.get(`${BASE}/api/account/profile`, { headers: ip() })).json()).toMatchObject({ displayName: "Isolated Bravo", email: b.email });
    // A's valid token cannot read B's profile through the data API either
    const rows = await ca.request.get(`${process.env.SUPABASE_API_URL}/rest/v1/profiles?id=eq.${b.id}&select=id,display_name`, { headers: { apikey: process.env.SUPABASE_ANON_KEY as string, Authorization: `Bearer ${a.session.access_token}` } });
    expect(await rows.json()).toEqual([]);
    await Promise.all([ca.close(), cb.close()]);
  });

  test("the same URL for two different learners is never served from a shared cache", async ({ browser, baseURL }) => {
    const [a, b] = await Promise.all([createAccount({ name: "Cache Alpha", learner: true }), createAccount({ name: "Cache Bravo", learner: true })]);
    const names: string[] = [];
    for (const who of [a, b, a, b]) {
      const c = await browser.newContext();
      await c.addCookies(sessionCookies(who));
      const body = await (await c.request.get(`${baseURL}/api/account/profile`, { headers: ip() })).text();
      names.push(JSON.parse(body).displayName);
      await c.close();
    }
    expect(names).toEqual(["Cache Alpha", "Cache Bravo", "Cache Alpha", "Cache Bravo"]);
  });
});

test.describe("private pages are never cached", () => {
  test("every private page and API answers with no-store, no framing and no sniffing", async ({ context, request }) => {
    const owner = await createAccount({ name: "Headers Owner", learner: true, admin: true });
    await context.addCookies(sessionCookies(owner));
    for (const path of ["/account", "/account/profile", "/account/profile/edit", "/account/invitations", "/api/account/me", "/api/account/profile", "/api/admin/invitations"]) {
      const res = await request.get(path, { headers: ip() });
      expect(res.status(), path).toBe(200);
      const h = res.headers();
      expect(h["cache-control"], path).toContain("no-store");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      if (path.startsWith("/api")) expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["etag"] ?? "", path).not.toMatch(/^W?\/"/); // no validators that would let a shared cache revalidate someone else's page
    }
  });

  test("after signing out, going Back shows nothing from the account", async ({ context, page }) => {
    const ana = await createAccount({ name: "Back Button Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    await page.goto("/account/profile");
    await expect(page.getByTestId("profile-name")).toHaveText("Back Button Ana");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await page.goBack();
    await expect(page.locator("body")).not.toContainText("Back Button Ana");
    await expect(page).toHaveURL(/\/signin\?e=session$/);
  });
});

test.describe("owner invitation management in the browser", () => {
  test("non-owners cannot even find the owner pages or use the owner API", async ({ context, page, request }) => {
    const learner = await createAccount({ name: "Not An Owner", learner: true });
    await context.addCookies(sessionCookies(learner));
    await page.goto("/account/invitations");
    await expect(page.getByText("This page could not be found")).toBeVisible();
    expect((await request.get("/api/admin/invitations", { headers: ip() })).status()).toBe(403);
    expect((await request.post("/api/admin/invitations", { data: { label: "x", maxUses: 1 }, headers: jsonHeaders() })).status()).toBe(403);
    expect((await request.post("/api/admin/invitations/11111111-1111-4111-8111-111111111111/expire", { headers: browserHeaders() })).status()).toBe(403);
  });

  test("create, copy, share a link, expire and revoke: the secret is shown once and lives nowhere else", async ({ browser, context, page }) => {
    const owner = await createAccount({ name: "Owner Olga", learner: true, admin: true });
    await context.addCookies(sessionCookies(owner));
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });

    // collect every response body the owner's page receives, to prove the list never carries a code
    const seen: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/admin/invitations") && r.request().method() === "GET") seen.push(await r.text().catch(() => ""));
    });

    await page.goto("/account/invitations");
    await expect(page.getByTestId("invitations-empty").or(page.getByTestId("invitation-row").first())).toBeVisible();
    await page.getByRole("button", { name: /Create an invitation/ }).click();
    await page.getByLabel("Who is this for?").fill("Autumn students");
    await page.getByRole("radio", { name: "5 people", exact: true }).check();
    await page.getByRole("radio", { name: "7 days" }).check();
    await page.getByRole("button", { name: "Create invitation" }).click();

    const code = (await page.getByTestId("invitation-code").textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}$/);
    const plain = code.replaceAll("-", "");

    await page.getByRole("button", { name: /Copy link/ }).click();
    await expect(page.getByTestId("copied")).toHaveText("Link copied.");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${BASE}/join#c=${plain}`);
    await page.getByRole("button", { name: "Copy code" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

    // while it is on screen it is in no browser storage, no cookie, and not in the address bar
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    expect(stored).not.toContain(plain);
    expect(JSON.stringify(await context.cookies())).not.toContain(plain);
    expect(page.url()).not.toContain(plain);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("invitation-code")).toHaveCount(0);
    const rowEl = page.getByTestId("invitation-row").filter({ hasText: "Autumn students" });
    await expect(rowEl).toContainText(`Code ending ${plain.slice(-4)}`);
    await expect(rowEl).toContainText("Active");
    await expect(rowEl).toContainText("0 of 5 used");
    await expect(page.locator("body")).not.toContainText(plain);
    await page.reload();
    await expect(page.locator("body")).not.toContainText(plain); // gone for good after a reload
    expect(seen.join("\n")).not.toContain(plain);
    expect(seen.join("\n")).not.toContain(code);
    expect((await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } })))).not.toContain(plain);

    // the shared link works: it fills the box, and the code never reaches the server in a URL
    const guest = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": uniqueIp() } });
    const gp = await guest.newPage();
    const requested: string[] = [];
    gp.on("request", (r) => requested.push(r.url()));
    await gp.goto(link);
    await expect(gp.getByLabel("Invitation code")).toHaveValue(plain);
    await expect(gp).toHaveURL(`${BASE}/join`); // the fragment is removed from the address bar at once
    expect(requested.join("\n")).not.toContain(plain);
    await guest.close();

    // expire now: confirm first, then nobody new can start with it
    await page.getByTestId("invitation-row").filter({ hasText: "Autumn students" }).getByRole("button", { name: "Expire now" }).click();
    await expect(page.getByTestId("invitation-confirm")).toContainText("already partway through signing in can finish");
    await page.getByRole("button", { name: "Expire now" }).click();
    await expect(page.getByTestId("invitation-row").filter({ hasText: "Autumn students" })).toContainText("Expired");
    const afterExpire = await page.request.post("/api/auth/join", { form: { code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(afterExpire.headers().location).toBe(`${BASE}/join?e=expired`);

    // revoke a second one through the confirmation screen
    await page.getByRole("button", { name: /Create an invitation/ }).click();
    await page.getByLabel("Who is this for?").fill("Beta friends");
    await page.getByRole("radio", { name: "1 person", exact: true }).check();
    await page.getByRole("button", { name: "Create invitation" }).click();
    const code2 = (await page.getByTestId("invitation-code").textContent())!.trim();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("invitation-row").filter({ hasText: "Beta friends" }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("invitation-confirm")).toContainText("Revoke “Beta friends”?");
    await page.getByRole("button", { name: "Keep it active" }).click();
    await expect(page.getByTestId("invitation-row").filter({ hasText: "Beta friends" })).toContainText("Active");
    await page.getByTestId("invitation-row").filter({ hasText: "Beta friends" }).getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(page.getByTestId("invitation-row").filter({ hasText: "Beta friends" })).toContainText("Revoked");
    const afterRevoke = await page.request.post("/api/auth/join", { form: { code: code2, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(afterRevoke.headers().location).toBe(`${BASE}/join?e=revoked`);

    // audited, with the owner as the actor, and no plaintext code anywhere in the audit log
    const audit = (await q("select kind, actor, meta::text as meta from public.audit_events where actor = $1 and kind in ('invite_created','invite_expired','invite_revoked')", [owner.id])).rows;
    const kinds = audit.map((a) => a.kind);
    expect(kinds.filter((k) => k === "invite_created")).toHaveLength(2);
    expect(kinds).toContain("invite_expired");
    expect(kinds).toContain("invite_revoked");
    expect(JSON.stringify(audit)).not.toContain(plain);
    expect(JSON.stringify(audit)).not.toContain(code2.replaceAll("-", ""));
  });

  test("an owner sees the Manage invitations link on their profile", async ({ context, page }) => {
    const owner = await createAccount({ name: "Link Owner", learner: true, admin: true });
    await context.addCookies(sessionCookies(owner));
    await page.goto("/account/profile");
    await page.getByRole("link", { name: "Manage invitations" }).click();
    await expect(page).toHaveURL(/\/account\/invitations$/);
    await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
  });
});
