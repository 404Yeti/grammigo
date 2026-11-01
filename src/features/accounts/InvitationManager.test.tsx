import "@/tests/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvitationManager } from "./InvitationManager";
import type { InvitationRow } from "./invitation-status";

const SECRET = "ABCD-EFGH-JKM";
const day = 86_400_000;
const row = (o: Partial<InvitationRow> = {}): InvitationRow => ({ id: "11111111-1111-4111-8111-111111111111", label: "Autumn students", code_hint: "EFGH", max_uses: 10, reserved_count: 4, redeemed_count: 4, expires_at: new Date(Date.now() + 12 * day).toISOString(), revoked_at: null, created_at: new Date().toISOString(), ...o });

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  }));
  return calls;
}
const clipboard = { writeText: vi.fn(async () => undefined) };
/** userEvent.setup() installs its own clipboard stub, so ours goes in AFTER it. */
const setup = () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  return user;
};

beforeEach(() => {
  clipboard.writeText.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("owner invitation list", () => {
  it("shows status, usage and expiry, and ONLY the last four characters of each code", async () => {
    mockFetch(() => ({ status: 200, body: { invitations: [
      row(),
      row({ id: "2", label: "Beta friends", code_hint: "WXYZ", reserved_count: 10, redeemed_count: 10 }),
      row({ id: "3", label: "Open day", code_hint: "QRST", expires_at: new Date(Date.now() - 2 * day).toISOString(), redeemed_count: 1, max_uses: 5, reserved_count: 1 }),
      row({ id: "4", label: "Withdrawn", code_hint: "MNPQ", revoked_at: new Date().toISOString() }),
    ] } }));
    render(<InvitationManager />);
    const rows = await screen.findAllByTestId("invitation-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Active")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(/40% used · 4 of 10 used · expires in 12 days/);
    expect(within(rows[1]).getByText("Full")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Expired")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Revoked")).toBeInTheDocument();
    expect(within(rows[0]).getByTestId("invitation-hint")).toHaveTextContent("Code ending EFGH");
    // nothing that could be a full code is on the page, and a finished invitation offers no actions
    expect(document.body.textContent).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}/);
    expect(within(rows[2]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[3]).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument(); // a list can never copy a code it does not have
  });

  it("says so when there are none", async () => {
    mockFetch(() => ({ status: 200, body: { invitations: [] } }));
    render(<InvitationManager />);
    expect(await screen.findByTestId("invitations-empty")).toBeInTheDocument();
  });

  it("shows a plain error when the list cannot be loaded", async () => {
    mockFetch(() => ({ status: 403, body: { error: "forbidden" } }));
    render(<InvitationManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t load/);
  });
});

describe("creating an invitation: the secret is shown once", () => {
  it("sends the choices, shows the full code, copies a FRAGMENT link, and the code is gone after Done", async () => {
    const calls = mockFetch((url, init) => (init?.method === "POST" ? { status: 201, body: { id: "x", code: SECRET, hint: "JKM", label: "Cohort", maxUses: 5, expiresAt: new Date(Date.now() + 14 * day).toISOString() } } : { status: 200, body: { invitations: [row({ label: "Cohort", code_hint: "HJKM" })] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: /Create an invitation/ }));
    expect(screen.getByRole("button", { name: "Create invitation" })).toBeDisabled(); // a label is required
    await user.type(screen.getByLabelText("Who is this for?"), "Cohort");
    await user.click(screen.getByRole("radio", { name: "5 people" }));
    await user.click(screen.getByRole("radio", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/admin/invitations");
    expect(JSON.parse(post.init!.body as string)).toEqual({ label: "Cohort", maxUses: 5, expiresInDays: 30 });

    expect(await screen.findByTestId("invitation-code")).toHaveTextContent(SECRET);
    await user.click(screen.getByRole("button", { name: /Copy link/ }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith(`${window.location.origin}/join#c=ABCDEFGHJKM`);
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith(SECRET);
    expect(screen.getByText(/can’t be shown again/)).toBeInTheDocument();

    // while it is shown it is NOT in any browser storage, and never in the URL
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("ABCD");
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain("ABCD");
    expect(window.location.href).not.toContain("ABCD");

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByTestId("invitation-code")).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain("ABCD-EFGH");
    expect(document.body.textContent).not.toContain("ABCDEFGH");
    expect(await screen.findByTestId("invitation-hint")).toHaveTextContent("Code ending HJKM");
  });

  it("never logs the code", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    mockFetch((_u, init) => (init?.method === "POST" ? { status: 201, body: { id: "x", code: SECRET, hint: "JKM", label: "L", maxUses: 1, expiresAt: "2026-12-01T00:00:00Z" } } : { status: 200, body: { invitations: [] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: /Create an invitation/ }));
    await user.type(screen.getByLabelText("Who is this for?"), "L");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByTestId("invitation-code");
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("ABCD");
    spies.forEach((s) => s.mockRestore());
  });

  it("shows a plain error and keeps the form when creating fails", async () => {
    mockFetch((_u, init) => (init?.method === "POST" ? { status: 429, body: { error: "rate_limited" } } : { status: 200, body: { invitations: [] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: /Create an invitation/ }));
    await user.type(screen.getByLabelText("Who is this for?"), "L");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many requests/);
    expect(screen.getByLabelText("Who is this for?")).toHaveValue("L");
  });
});

describe("revoking and expiring", () => {
  it("asks first, explains the effect, and only then calls the server", async () => {
    const calls = mockFetch((url, init) => (init?.method === "POST" ? { status: 200, body: { revoked: true } } : { status: 200, body: { invitations: [row()] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const confirm = screen.getByTestId("invitation-confirm");
    expect(confirm).toHaveTextContent(/Revoke “Autumn students”\?/);
    expect(confirm).toHaveTextContent(/People who already joined keep their accounts and progress/);
    expect(confirm).toHaveTextContent("Code ending EFGH");
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false); // nothing happened yet
    await user.click(screen.getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/revoke") && c.init?.method === "POST")).toBe(true));
  });

  it("'Keep it active' leaves everything alone", async () => {
    const calls = mockFetch(() => ({ status: 200, body: { invitations: [row()] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Keep it active" }));
    expect(await screen.findByTestId("invitation-row")).toBeInTheDocument();
    expect(calls.every((c) => c.init?.method !== "POST")).toBe(true);
  });

  it("expire now confirms, explains that people mid sign-in can finish, and calls the expire endpoint", async () => {
    const calls = mockFetch((url, init) => (init?.method === "POST" ? { status: 200, body: { expired: true } } : { status: 200, body: { invitations: [row()] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: "Expire now" }));
    expect(screen.getByTestId("invitation-confirm")).toHaveTextContent(/already partway through signing in can finish/);
    await user.click(screen.getByRole("button", { name: "Expire now" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/expire") && c.init?.method === "POST")).toBe(true));
  });

  it("a failure is reported and nothing is assumed", async () => {
    mockFetch((_u, init) => (init?.method === "POST" ? { status: 500, body: {} } : { status: 200, body: { invitations: [row()] } }));
    const user = setup();
    render(<InvitationManager />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Revoke invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t revoke/);
  });
});
