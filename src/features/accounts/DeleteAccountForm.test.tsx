import "@/tests/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { DeleteAccountForm } from "./DeleteAccountForm";
import { removeAccountFromDevice } from "./local-cleanup";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const replace = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  setStorageScope(A);
  replace.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, replace } });
});

async function fill(user: ReturnType<typeof userEvent.setup>, phrase = "Delete my account") {
  await user.type(screen.getByTestId("delete-phrase"), phrase);
  await user.click(screen.getByTestId("delete-understood"));
}
const reply = (status: number, body: unknown = {}) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("the delete form", () => {
  it("cannot be submitted until the words match AND the box is ticked, and sends nothing before that", async () => {
    const f = reply(200, { deleted: true });
    const user = userEvent.setup();
    render(<DeleteAccountForm accountId={A} />);
    const submit = screen.getByTestId("delete-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId("delete-phrase"), "delete");
    await user.click(screen.getByTestId("delete-understood"));
    expect(submit).toBeDisabled();
    await user.clear(screen.getByTestId("delete-phrase"));
    await user.type(screen.getByTestId("delete-phrase"), "  DELETE   my account ");
    expect(submit).toBeEnabled();
    expect(f).not.toHaveBeenCalled();
  });

  it("sends ONE request that names nobody, then removes only THIS account's local copy and leaves the guest's and other accounts' alone", async () => {
    window.localStorage.setItem(`grammigo:v2:u:${A}`, "a");
    window.localStorage.setItem(`grammigo:guided:v1:u:${A}`, "ag");
    window.localStorage.setItem(`grammigo:sync:v1:u:${A}`, "am");
    window.localStorage.setItem("grammigo:v2", "GUEST");
    window.localStorage.setItem(`grammigo:v2:u:${B}`, "OTHER");
    const f = reply(200, { deleted: true });
    const user = userEvent.setup();
    render(<DeleteAccountForm accountId={A} />);
    await fill(user);
    await user.click(screen.getByTestId("delete-submit"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/auth/deleted"));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/account/delete");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ confirm: "Delete my account" });
    expect(window.localStorage.getItem(`grammigo:v2:u:${A}`)).toBeNull();
    expect(window.localStorage.getItem(`grammigo:guided:v1:u:${A}`)).toBeNull();
    expect(window.localStorage.getItem(`grammigo:sync:v1:u:${A}`)).toBeNull();
    expect(window.localStorage.getItem("grammigo:v2")).toBe("GUEST");
    expect(window.localStorage.getItem(`grammigo:v2:u:${B}`)).toBe("OTHER");
  });

  it("keeps the local copy when the learner unticks that choice", async () => {
    window.localStorage.setItem(`grammigo:v2:u:${A}`, "a");
    reply(200, { deleted: true });
    const user = userEvent.setup();
    render(<DeleteAccountForm accountId={A} />);
    await fill(user);
    await user.click(screen.getByTestId("delete-local"));
    await user.click(screen.getByTestId("delete-submit"));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(window.localStorage.getItem(`grammigo:v2:u:${A}`)).toBe("a");
  });

  it.each([
    [403, { error: "reauth_required" }, /sign in with Google again/i],
    [429, { error: "rate_limited" }, /Too many tries/],
    [400, { error: "confirmation" }, /words didn’t match/],
    [409, { error: "owner_account" }, /owner account/],
    [500, { error: "delete_failed" }, /NOT deleted/],
    [503, { error: "unavailable" }, /NOT deleted/],
  ])("a %i answer says plainly that nothing was deleted, keeps the local copy and does not leave the page", async (status, body, text) => {
    window.localStorage.setItem(`grammigo:v2:u:${A}`, "a");
    reply(status, body);
    const user = userEvent.setup();
    render(<DeleteAccountForm accountId={A} />);
    await fill(user);
    await user.click(screen.getByTestId("delete-submit"));
    expect(await screen.findByTestId("delete-error")).toHaveTextContent(text);
    expect(replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(`grammigo:v2:u:${A}`)).toBe("a");
    expect(screen.queryByTestId("delete-reauth") !== null).toBe(status === 403);
  });

  it("a network failure says nothing was deleted", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    render(<DeleteAccountForm accountId={A} />);
    await fill(user);
    await user.click(screen.getByTestId("delete-submit"));
    expect(await screen.findByTestId("delete-error")).toHaveTextContent(/Nothing was deleted/);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("removing an account's copy from the device", () => {
  it("refuses the guest scope and anything that is not an account id", () => {
    window.localStorage.setItem("grammigo:v2", "GUEST");
    expect(removeAccountFromDevice("")).toBe(false);
    expect(removeAccountFromDevice("../x")).toBe(false);
    expect(window.localStorage.getItem("grammigo:v2")).toBe("GUEST");
  });
});
