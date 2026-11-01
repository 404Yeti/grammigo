import "@/tests/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { router } from "@/tests/helpers";
import { ProfileForm } from "./ProfileForm";

const topics = ["Articles", "Conditionals", "Prepositions"];
const initial = { displayName: "Ana", firstLanguage: "", practising: ["Articles"], dailyMinutes: 10 as const };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  router.push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const save = () => screen.getByRole("button", { name: /Save changes|Saving/ });

describe("edit profile form", () => {
  it("starts with the saved values and nothing to save", () => {
    render(<ProfileForm topics={topics} initial={initial} />);
    expect(screen.getByLabelText("Display name")).toHaveValue("Ana");
    expect(screen.getByRole("button", { name: "Articles" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Conditionals" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("radio", { name: "About 10 minutes" })).toBeChecked();
    expect(save()).toBeDisabled();
  });

  it("sends ONLY the editable fields (no id, no status, nothing that names whose profile this is)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const user = userEvent.setup();
    render(<ProfileForm topics={topics} initial={initial} />);
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Ana María");
    await user.click(screen.getByRole("button", { name: "Conditionals" }));
    await user.click(screen.getByRole("radio", { name: "15 minutes or more" }));
    await user.click(save());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/profile");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ displayName: "Ana María", firstLanguage: null, practising: ["Articles", "Conditionals"], dailyMinutes: 15 });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/account/profile?saved=1"));
  });

  it("shows plain field messages from the server's codes, keeps what was typed, and does not navigate", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "invalid", fields: { displayName: "name_invalid" } }) });
    const user = userEvent.setup();
    render(<ProfileForm topics={topics} initial={initial} />);
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Bad");
    await user.click(save());
    expect(await screen.findByText("That name has characters we can’t use.")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Bad");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("handles an ended session, a rate limit and a network failure without losing the edits", async () => {
    const user = userEvent.setup();
    render(<ProfileForm topics={topics} initial={initial} />);
    await user.type(screen.getByLabelText("Display name"), "x");
    for (const [res, text] of [
      [{ ok: false, status: 401, json: async () => ({}) }, /session ended/],
      [{ ok: false, status: 429, json: async () => ({}) }, /Too many saves/],
      [null, /couldn’t reach Grammigo/],
    ] as const) {
      if (res) fetchMock.mockResolvedValueOnce(res);
      else fetchMock.mockRejectedValueOnce(new Error("offline"));
      await user.click(save());
      expect(await screen.findByTestId("profile-form-error")).toHaveTextContent(text);
    }
    expect(screen.getByLabelText("Display name")).toHaveValue("Anax");
  });

  it("asks before leaving with unsaved changes, and not when there are none", async () => {
    const user = userEvent.setup();
    render(<ProfileForm topics={topics} initial={initial} />);
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await user.type(screen.getByLabelText("Display name"), "!");
    expect(leave()).toBe(true);
  });

  it("limits how many topics can be chosen", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `Topic ${i}`);
    const user = userEvent.setup();
    render(<ProfileForm topics={many} initial={{ ...initial, practising: [] }} />);
    for (const t of many) await user.click(screen.getByRole("button", { name: t }));
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(8);
  });
});
