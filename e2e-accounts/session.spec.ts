import { BASE, browserHeaders, COOKIE, cookiesFor, createAccount, revokeSessions, sessionCookies, uniqueIp } from "./helpers";
import { expect, test } from "./fixtures";

const ip = () => ({ "x-real-ip": uniqueIp() });

test.describe("a visitor with no session", () => {
  test("is redirected from /account before anything renders, and the redirect is not cacheable", async ({ request, page }) => {
    const res = await request.get("/account", { headers: ip(), maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/signin\?e=session$/);
    expect(res.headers()["cache-control"]).toContain("no-store");
    await page.goto("/account");
    await expect(page).toHaveURL(/\/signin\?e=session$/);
    await expect(page.locator("main p[role=alert]")).toContainText("Your session ended");
  });

  test("gets 401 from the account API and 401 from the owner API", async ({ request }) => {
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(401);
    expect((await request.get("/api/admin/invitations", { headers: ip() })).status()).toBe(401);
  });

  test("still uses Grammigo exactly as before: lessons, library and onboarding work, no cookie is set, no account code runs", async ({ request }) => {
    for (const path of ["/", "/library", "/onboarding", "/privacy"]) {
      const res = await request.get(path, { headers: ip() });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["set-cookie"], path).toBeUndefined();
    }
  });
});

test.describe("an uninvited Google identity (a real session, no learner profile)", () => {
  test("sees nothing private and can use no account function", async ({ context, page, request }) => {
    const stranger = await createAccount({ name: "Stranger Danger" });
    await context.addCookies(sessionCookies(stranger));

    await page.goto("/account");
    await expect(page).toHaveURL(/\/auth\/no-account$/);
    await expect(page.locator("body")).not.toContainText("Stranger Danger");
    await expect(page.locator("body")).not.toContainText(stranger.email);

    const me = await request.get("/api/account/me", { headers: ip() });
    expect(me.status()).toBe(403);
    expect(await me.json()).toEqual({ error: "forbidden" });
    expect((await request.get("/api/admin/invitations", { headers: ip() })).status()).toBe(403);
    expect((await request.post("/api/admin/invitations", { data: { label: "x", maxUses: 1 }, headers: browserHeaders() })).status()).toBe(403);
  });
});

test.describe("a learner", () => {
  test("sees their own account page; private pages and API answers are never cacheable", async ({ context, page, request }) => {
    const ana = await createAccount({ name: "Ana Learner", learner: true });
    await context.addCookies(sessionCookies(ana));

    const res = await page.goto("/account");
    expect(res?.status()).toBe(200);
    expect(res?.headers()["cache-control"]).toContain("no-store");
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
    expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page.getByRole("heading", { name: "Hi, Ana Learner" })).toBeVisible();

    const me = await request.get("/api/account/me", { headers: ip() });
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ displayName: "Ana Learner" });
    expect(me.headers()["cache-control"]).toContain("no-store");
    expect(me.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("is not an owner: the invitation API is closed to them", async ({ context, request }) => {
    const ana = await createAccount({ name: "Plain Learner", learner: true });
    await context.addCookies(sessionCookies(ana));
    expect((await request.get("/api/admin/invitations", { headers: ip() })).status()).toBe(403);
    expect((await request.post("/api/admin/invitations", { data: { label: "x", maxUses: 1 }, headers: browserHeaders() })).status()).toBe(403);
  });

  test("can keep practising with an account and the learning pages do not touch their session", async ({ context, request }) => {
    const ana = await createAccount({ name: "Practising Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    for (const path of ["/", "/library", "/onboarding"]) {
      const res = await request.get(path, { headers: ip() });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["set-cookie"], path).toBeUndefined();
    }
  });
});

test.describe("cross-account isolation", () => {
  test("two learners in two browsers each see only themselves, and one learner's cookie never shows the other's name", async ({ browser }) => {
    const [a, b] = await Promise.all([createAccount({ name: "Alpha Learner", learner: true }), createAccount({ name: "Bravo Learner", learner: true })]);
    const [ca, cb] = await Promise.all([browser.newContext(), browser.newContext()]);
    await ca.addCookies(sessionCookies(a));
    await cb.addCookies(sessionCookies(b));
    const [pa, pb] = [await ca.newPage(), await cb.newPage()];
    await pa.goto(`${BASE}/account`);
    await pb.goto(`${BASE}/account`);
    await expect(pa.getByRole("heading", { name: "Hi, Alpha Learner" })).toBeVisible();
    await expect(pb.getByRole("heading", { name: "Hi, Bravo Learner" })).toBeVisible();
    await expect(pa.locator("body")).not.toContainText("Bravo");
    await expect(pb.locator("body")).not.toContainText("Alpha");
    expect(await (await ca.request.get(`${BASE}/api/account/me`, { headers: ip() })).json()).toEqual({ displayName: "Alpha Learner" });
    expect(await (await cb.request.get(`${BASE}/api/account/me`, { headers: ip() })).json()).toEqual({ displayName: "Bravo Learner" });
    // A cannot read B's row through the data API even with A's valid token
    const rows = await ca.request.get(`${process.env.SUPABASE_API_URL}/rest/v1/profiles?id=eq.${b.id}&select=id,display_name`, { headers: { apikey: process.env.SUPABASE_ANON_KEY as string, Authorization: `Bearer ${a.session.access_token}` } });
    expect(await rows.json()).toEqual([]);
    await Promise.all([ca.close(), cb.close()]);
  });
});

test.describe("the owner", () => {
  test("creates an invitation (the code is shown once), lists it without the code, and revokes it", async ({ context, request }) => {
    const owner = await createAccount({ name: "Owner Person", learner: true, admin: true });
    await context.addCookies(sessionCookies(owner));

    const created = await request.post("/api/admin/invitations", { data: { label: "browser test", maxUses: 3, expiresInDays: 7 }, headers: browserHeaders() });
    expect(created.status()).toBe(201);
    expect(created.headers()["cache-control"]).toContain("no-store");
    const body = await created.json();
    expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}$/);

    const list = await request.get("/api/admin/invitations", { headers: ip() });
    expect(list.status()).toBe(200);
    const text = await list.text();
    expect(text).toContain(body.id);
    expect(text).not.toContain(body.code);
    expect(text).not.toMatch(/code_hash/);

    const cross = await request.post("/api/admin/invitations", { data: { label: "x", maxUses: 1 }, headers: { origin: "https://evil.example", "x-real-ip": uniqueIp() } });
    expect(cross.status()).toBe(403);

    const revoked = await request.post(`/api/admin/invitations/${body.id}/revoke`, { headers: browserHeaders() });
    expect(revoked.status()).toBe(200);
    const after = await request.post("/api/auth/join", { form: { code: body.code, adult: "on" }, headers: browserHeaders(), maxRedirects: 0 });
    expect(after.headers().location).toBe(`${BASE}/join?e=revoked`);
  });
});

test.describe("session expiry and revocation", () => {
  test("a session revoked on the server stops working at once, even though the cookie is still in the browser", async ({ context, page, request }) => {
    const ana = await createAccount({ name: "Revoked Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(200);
    await revokeSessions(ana);
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(401);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/signin\?e=session$/);
  });

  test("an expired access token is refreshed with the refresh token, and the new cookie is httpOnly", async ({ context, request }) => {
    const ana = await createAccount({ name: "Refreshing Ana", learner: true });
    await context.addCookies(sessionCookies(ana, { expired: true }));
    const res = await request.get("/api/account/me", { headers: ip() });
    expect(res.status()).toBe(200);
    const set = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    const mine = set.filter((v) => v.startsWith(`${COOKIE}=`) || v.startsWith(`${COOKIE}.`));
    expect(mine.length).toBeGreaterThan(0);
    for (const v of mine) {
      expect(v).toMatch(/HttpOnly/i);
      expect(v).toMatch(/SameSite=Lax/i);
      expect(v).toMatch(/Path=\//);
    }
    // and the refreshed session keeps working
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(200);
  });

  test("an expired access token with a refresh token the server no longer knows is simply signed out", async ({ context, request, page }) => {
    const ana = await createAccount({ name: "Lapsed Ana", learner: true });
    await context.addCookies(sessionCookies(ana, { expired: true, refreshToken: "not-a-real-refresh-token" }));
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(401);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/signin\?e=session$/);
  });

  test("a tampered, truncated or garbage session cookie is signed out, never an error page", async ({ context, request }) => {
    const ana = await createAccount({ name: "Tampered Ana", learner: true });
    const good = sessionCookies(ana).map((c) => c.value).join("");
    for (const value of ["base64-AAAA", "garbage", good.slice(0, 40), good.slice(0, 60) + (good[60] === "A" ? "B" : "A") + good.slice(61)]) {
      await context.clearCookies();
      await context.addCookies(cookiesFor(value));
      const res = await request.get("/api/account/me", { headers: ip() });
      expect(res.status(), value.slice(0, 20)).toBe(401);
    }
  });
});

test.describe("signing out", () => {
  test("clears the cookie, revokes the session on the server (a copied cookie is dead), and the Back button shows nothing private", async ({ context, page, request }) => {
    const ana = await createAccount({ name: "Leaving Ana", learner: true });
    const cookies = sessionCookies(ana);
    await context.addCookies(cookies);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Hi, Leaving Ana" })).toBeVisible();

    await page.getByRole("link", { name: "Your profile" }).click(); // sign-out lives on the profile page
    await expect(page).toHaveURL(/\/account\/profile$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${BASE}/onboarding`);
    expect((await context.cookies()).some((c) => c.name.startsWith(COOKIE))).toBe(false);

    await page.goBack();
    await expect(page.locator("body")).not.toContainText("Leaving Ana");
    await expect(page).toHaveURL(/\/signin\?e=session$/);

    // someone who copied the cookie before sign-out gets nothing
    await context.addCookies(cookies);
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(401);
  });

  test("cannot be forced from another site (no logout CSRF)", async ({ context, request }) => {
    const ana = await createAccount({ name: "Steady Ana", learner: true });
    await context.addCookies(sessionCookies(ana));
    const res = await request.post("/api/auth/signout", { headers: { origin: "https://evil.example", "x-real-ip": uniqueIp() }, maxRedirects: 0 });
    expect(res.status()).toBe(403);
    expect((await request.get("/api/account/me", { headers: ip() })).status()).toBe(200);
  });
});

test.describe("the guest transfer is off in this build", () => {
  test("both transfer pages are 404 unless the build switches them on", async ({ request }) => {
    for (const p of ["/transfer/send", "/transfer/receive"]) expect((await request.get(p, { maxRedirects: 0 })).status(), p).toBe(404);
  });
});
