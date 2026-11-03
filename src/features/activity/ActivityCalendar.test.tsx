import "@/tests/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityCalendar } from "./ActivityCalendar";
import { HomeScreen } from "@/features/lessons/HomeScreen";
import { activitySession } from "@/tests/activity-fixtures";
import { getSnapshot, updateState } from "@/lib/storage/store";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { resetApp } from "@/tests/helpers";

const date = (id: string, at: string) => activitySession(id, Date.parse(at));
let zone = "UTC";
beforeEach(() => {
  resetApp(); zone = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: zone }; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("shows real activity, all-time counts, a bounded calendar and keyboard navigation", async () => {
  const user = userEvent.setup();
  const records = [date("oct", "2026-10-31T12:00Z"), date("nov", "2026-11-01T12:00Z"), date("repeat", "2026-11-01T16:00Z"), date("two", "2026-11-02T12:00Z"), date("today", "2026-11-03T09:00Z"), date("future", "2026-11-04T12:00Z")];
  render(<ActivityCalendar sessions={records} />);
  expect(screen.getByTestId("active-days")).toHaveTextContent("4 days");
  expect(screen.getByTestId("current-streak")).toHaveTextContent("4 days");
  expect(screen.getByTestId("longest-streak")).toHaveTextContent("4 days");
  expect(screen.getByRole("table")).toHaveAccessibleName(/November 2026: 3 active days/);
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  expect(document.querySelector('[data-date="2026-11-04"]')).toHaveAttribute("data-active", "false");
  expect(screen.getByLabelText("Tuesday, 3 November 2026")).toHaveAttribute("aria-current", "date");
  const previous = screen.getByRole("button", { name: "Previous month" });
  previous.focus(); await user.keyboard("{Enter}");
  expect(screen.getByTestId("calendar-month")).toHaveTextContent("October 2026");
  expect(previous).toBeDisabled();
  expect(screen.getByRole("table")).toHaveAccessibleName(/October 2026: 1 active day/);
  await user.click(screen.getByRole("button", { name: "This month" }));
  expect(screen.getByTestId("calendar-month")).toHaveTextContent("November 2026");
  expect(screen.getByTestId("active-days")).toHaveTextContent("4 days");
});

it("offers an honest empty state without future navigation or invented dates", () => {
  render(<ActivityCalendar sessions={[]} />);
  expect(screen.getByText(/Migo will mark your first active day/)).toBeInTheDocument();
  for (const id of ["active-days", "current-streak", "longest-streak"]) expect(screen.getByTestId(id)).toHaveTextContent("0 days");
  expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
});

it("reprojects saved completions when the device timezone changes and the page regains focus", () => {
  render(<ActivityCalendar sessions={[date("near-midnight", "2026-11-03T00:30Z")]} />);
  expect(document.querySelector('[data-date="2026-11-03"]')).toHaveAttribute("data-active", "true");
  zone = "America/Los_Angeles"; fireEvent.focus(window);
  expect(document.querySelector('[data-date="2026-11-02"]')).toHaveAttribute("data-active", "true");
  expect(document.querySelector('[data-date="2026-11-03"]')).toHaveAttribute("data-active", "false");
  expect(screen.getByText(/America\/Los Angeles/)).toBeInTheDocument();
});

it("updates at local midnight without a reload and follows a new month", () => {
  vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-30T23:59:50Z"));
  render(<ActivityCalendar sessions={[date("previous-day", "2026-11-29T12:00Z")]} />);
  expect(screen.getByTestId("current-streak")).toHaveTextContent("1 day");
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByTestId("calendar-month")).toHaveTextContent("December 2026");
  expect(screen.getByTestId("current-streak")).toHaveTextContent("0 days");
  expect(screen.getByText("No lessons completed this month.")).toBeInTheDocument();
});

it("reads the dashboard's current learner scope and resets month navigation on account switches", async () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const seed = (records: ReturnType<typeof activitySession>[]) => updateState(s => ({ ...s, onboarding: { ...s.onboarding, status: "skipped" }, sessions: records }));
  seed([date("guest-old", "2026-10-01T12:00Z"), date("guest-new", "2026-11-01T12:00Z")]);
  const guest = JSON.stringify(getSnapshot());
  setStorageScope(a); seed([date("a-only", "2026-10-02T12:00Z")]);
  setStorageScope(b); seed([]); setStorageScope("");
  render(<HomeScreen />);
  const calendar = () => within(screen.getByTestId("activity-calendar"));
  expect(calendar().getByTestId("active-days")).toHaveTextContent("2 days");
  await userEvent.click(calendar().getByRole("button", { name: "Previous month" }));
  act(() => setStorageScope(a));
  expect(calendar().getByTestId("calendar-month")).toHaveTextContent("November 2026");
  expect(calendar().getByTestId("active-days")).toHaveTextContent("1 day");
  await userEvent.click(calendar().getByRole("button", { name: "Previous month" }));
  expect(document.querySelector('[data-date="2026-10-01"]')).toHaveAttribute("data-active", "false");
  expect(document.querySelector('[data-date="2026-10-02"]')).toHaveAttribute("data-active", "true");
  act(() => setStorageScope(b));
  expect(calendar().getByTestId("active-days")).toHaveTextContent("0 days");
  expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  act(() => setStorageScope(""));
  expect(calendar().getByTestId("active-days")).toHaveTextContent("2 days");
  expect(JSON.stringify(getSnapshot())).toBe(guest);
});
