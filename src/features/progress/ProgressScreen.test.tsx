import "@/tests/mocks";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeScreen } from "@/features/lessons/HomeScreen";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { emptyState } from "@/lib/storage/schema";
import { updateState } from "@/lib/storage/store";
import { resetApp } from "@/tests/helpers";
import { PROGRESS_NOW, progressFixture } from "@/tests/progress-fixtures";
import { ProgressScreen } from "./ProgressScreen";

beforeEach(() => { resetApp(); vi.spyOn(Date, "now").mockReturnValue(PROGRESS_NOW); });
afterEach(() => vi.restoreAllMocks());

it("offers an accessible empty state and explains the missing CEFR estimate honestly", async () => {
  render(<ProgressScreen />);
  expect(await screen.findByRole("heading", {name:"Your progress"})).toBeInTheDocument();
  expect(screen.getByTestId("progress-empty")).toHaveTextContent(/one lesson/);
  expect(screen.getByTestId("progress-completed")).toHaveTextContent("0");
  expect(screen.getByTestId("progress-placement")).toHaveTextContent(/No CEFR placement estimate/);
  expect(screen.getByRole("link",{name:"Browse all lessons"})).toHaveAttribute("href","/library");
  expect(document.body.textContent).not.toMatch(/\d+%|certified|mastery score/i);
});

it("shows demonstrated performance, review and uncertain writing separately, with real session links", async () => {
  updateState(() => progressFixture()); render(<ProgressScreen />);
  const topics = await screen.findByTestId("progress-grammar-list");
  expect(topics).toHaveTextContent("Demonstrated strength"); expect(topics).toHaveTextContent("Worth reviewing");
  expect(topics).toHaveTextContent("Early evidence"); expect(topics).toHaveTextContent("Not enough checked evidence");
  expect(screen.getByTestId("progress-completed")).toHaveTextContent("3");
  expect(within(screen.getByTestId("progress-recent-list")).getAllByRole("link")[0]).toHaveAttribute("href","/practice/a1-articles/review?session=unchecked");
  expect(screen.getByTestId("progress-levels")).toHaveTextContent("16 checked answers");
});

it("uses the same first recommendation and explanation as Home", async () => {
  updateState(() => progressFixture());
  const view = render(<HomeScreen />);
  const reason = (await screen.findByTestId("next-step-text")).textContent;
  const href = screen.getByRole("link",{name:"Start Practice"}).getAttribute("href");
  view.unmount(); render(<ProgressScreen />);
  const next = await screen.findByTestId("progress-recommendations");
  expect(within(next).getAllByRole("link")[0]).toHaveAttribute("href",href);
  expect(next.textContent).toContain(reason);
  expect(within(next).getAllByRole("listitem")).toHaveLength(2);
});

it("drops every prior learner's profile, placement evidence and recent history on scope switches", async () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  setStorageScope(a); updateState(() => progressFixture());
  render(<ProgressScreen />);
  expect(await screen.findByTestId("progress-completed")).toHaveTextContent("3");
  act(() => setStorageScope(b));
  expect(screen.getByTestId("progress-completed")).toHaveTextContent("0");
  expect(screen.queryByTestId("progress-grammar-list")).not.toBeInTheDocument();
  expect(screen.queryByTestId("progress-levels")).not.toBeInTheDocument();
  act(() => {setStorageScope("");updateState(() => emptyState());});
  expect(screen.getByTestId("progress-completed")).toHaveTextContent("0");
  act(() => setStorageScope(a)); expect(screen.getByTestId("progress-completed")).toHaveTextContent("3");
});
