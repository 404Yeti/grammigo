import "@/tests/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { playQuestions, resetApp } from "@/tests/helpers";
import { SyncCard } from "./ui/SyncCard";
import { buildLocalCopy, downloadLocalCopy, localCopyFilename } from "./local-export";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const status = { phase: "too_large", unsaved: true, lastSyncedAt: null, nextAttemptAt: null, paused: false };
vi.mock("./hooks", () => ({ useSyncEngine: () => ({ enable() {}, pause() {}, syncNow() {}, getMetrics: () => ({ calls: 0 }) }), useSyncStatus: () => status }));

beforeEach(() => resetApp());

describe("a copy of the progress on this device", () => {
  it("contains only the learner who is using the device now, and changes nothing", () => {
    setStorageScope(A);
    playQuestions(8);
    setStorageScope(B);
    playQuestions(3);
    const before = JSON.stringify({ ...window.localStorage });
    const mine = buildLocalCopy(new Date("2026-11-01T00:00:00Z"));
    expect(mine).toMatchObject({ format: "grammigo-device-copy", scope: "account", exportedAt: "2026-11-01T00:00:00.000Z" });
    expect((mine.lessons as { sessions: unknown[] }).sessions).toHaveLength(1);
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
    setStorageScope(A);
    const a = buildLocalCopy();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(mine));
    setStorageScope("");
    expect(buildLocalCopy().scope).toBe("guest");
    expect(localCopyFilename(new Date("2026-11-01T10:00:00Z"))).toBe("grammigo-progress-on-this-device-2026-11-01.json");
  });
});

describe("the size-limit warning", () => {
  it("is a clear alert, never says 'saved to your account', and offers the download", async () => {
    setStorageScope(A);
    playQuestions(8);
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => (created.push(b as Blob), "blob:test"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<SyncCard />);
    const warn = screen.getByTestId("too-large-warning");
    expect(warn).toHaveAttribute("role", "alert");
    expect(warn).toHaveTextContent(/not being saved to your account/i);
    expect(warn).toHaveTextContent(/safe on this device/i);
    expect(screen.queryByText(/Saved to your account/)).toBeNull();
    await user.click(screen.getByTestId("download-copy"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    const text = await created[0].text();
    expect(JSON.parse(text)).toMatchObject({ format: "grammigo-device-copy", scope: "account" });
    expect(screen.getByText(/A copy was downloaded/)).toBeInTheDocument();
  });

  it("downloadLocalCopy reports false when the browser refuses", () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error("no");
    });
    expect(downloadLocalCopy()).toBe(false);
  });
});
