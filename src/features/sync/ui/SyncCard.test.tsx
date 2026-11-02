import "@/tests/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "../engine";
import { SyncCardView } from "./SyncCard";

afterEach(cleanup);
const status = (over: Partial<SyncStatus>): SyncStatus => ({ phase: "idle", unsaved: false, lastSyncedAt: Date.now() - 90_000, nextAttemptAt: null, paused: false, ...over });
const controls = () => ({ enable: vi.fn(), pause: vi.fn(), syncNow: vi.fn() });

describe("the saving card", () => {
  it("when everything is saved it says so plainly: no 'Saving to my account', no timings, no request counts, no connection details", () => {
    render(<SyncCardView engine={controls()} status={status({})} />);
    expect(screen.getByRole("heading", { name: "Your progress" })).toBeInTheDocument();
    expect(screen.getByTestId("sync-label")).toHaveTextContent("All saved");
    expect(screen.getByTestId("sync-detail")).toHaveTextContent("Your progress is safe in your account.");
    const text = screen.getByTestId("sync-card").textContent ?? "";
    expect(text).not.toMatch(/Saving to my account/);
    expect(text).not.toMatch(/Connection details|request|\bms\b|typical|slowest|Last saved|ago/i);
  });

  it("the manual controls are tucked under 'Saving options' (closed) when nothing needs doing, and still work", async () => {
    const c = controls();
    render(<SyncCardView engine={c} status={status({})} />);
    const options = screen.getByTestId("sync-options") as HTMLDetailsElement;
    expect(options.open).toBe(false);
    expect(screen.getByText("Saving options")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Saving options"));
    await userEvent.click(screen.getByRole("button", { name: "Turn off on this device" }));
    expect(c.pause).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(c.syncNow).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unsaved changes", status({ unsaved: true }), /Saved on this device/],
    ["a failed save that will be retried", status({ phase: "retrying" }), /Saved on this device/],
    ["no connection", status({ phase: "offline" }), /Offline/],
  ])("%s: the problem is visible and 'Save now' is offered up front", async (_n, s, label) => {
    const c = controls();
    render(<SyncCardView engine={c} status={s} />);
    expect(screen.getByTestId("sync-label")).toHaveTextContent(label);
    expect(screen.getByTestId("sync-label")).not.toHaveTextContent("All saved");
    const saveNow = screen.getAllByRole("button", { name: "Save now" });
    expect(saveNow).toHaveLength(1); // not duplicated under the options
    await userEvent.click(saveNow[0]);
    expect(c.syncNow).toHaveBeenCalledTimes(1);
  });

  it("while saving it says so, offers no 'Save now', and tells the learner they can carry on", () => {
    render(<SyncCardView engine={controls()} status={status({ phase: "syncing", unsaved: true })} />);
    expect(screen.getByTestId("sync-label")).toHaveTextContent("Saving…");
    expect(screen.getByTestId("sync-detail")).toHaveTextContent(/keep learning/);
    expect(screen.queryAllByRole("button", { name: "Save now" }).every((b) => (b.closest("details") as HTMLDetailsElement | null)?.open === false)).toBe(true);
  });

  it("a signed-out session and an over-large progress keep their full, honest explanations; 'Save now' is not offered where it cannot work", () => {
    const { rerender } = render(<SyncCardView engine={controls()} status={status({ phase: "needs_signin", unsaved: true })} />);
    expect(screen.getByTestId("sync-detail")).toHaveTextContent(/Sign in again/);
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/signin");
    expect(screen.getAllByRole("button", { name: "Save now" }).every((b) => (b.closest("details") as HTMLDetailsElement | null)?.open === false)).toBe(true);
    rerender(<SyncCardView engine={controls()} status={status({ phase: "too_large" })} />);
    expect(screen.getByTestId("too-large-warning")).toHaveTextContent(/not being saved to your account/);
    expect(screen.getByTestId("download-copy")).toBeInTheDocument();
  });

  it("when saving is off, the consent card is unchanged: it says exactly what is saved before asking", async () => {
    const c = controls();
    render(<SyncCardView engine={c} status={status({ phase: "needs_consent", lastSyncedAt: null })} />);
    expect(screen.getByRole("heading", { name: /Keep my progress in my account/ })).toBeInTheDocument();
    expect(screen.getByText(/never audio/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on saving to my account" }));
    expect(c.enable).toHaveBeenCalledTimes(1);
  });
});
