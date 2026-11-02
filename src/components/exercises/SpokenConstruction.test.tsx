import "@/tests/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getLesson } from "@/data/lessons";
import { SpokenConstruction } from "./SpokenConstruction";
vi.mock("@/features/speaking/SpeakingAnswer", () => ({ SpeakingAnswer: () => <label>Your answer<input /></label> }));
afterEach(cleanup);
it("keeps the construction words visible when switching from tiles to speech/typing", () => {
  const question = getLesson("present-perfect-vs-past-simple")!.questions[4];
  render(<SpokenConstruction lessonId="present-perfect-vs-past-simple" question={question} value="" disabled={false} onChange={vi.fn()} />);
  expect(screen.getByRole("group", { name: "Available words" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Speak or type my sentence" }));
  expect(screen.getByText(/Use these words:/)).toHaveTextContent("since · They · 2018 · lived · here · have");
  expect(screen.getByLabelText("Your answer")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to word tiles" }));
  expect(screen.getByRole("group", { name: "Available words" })).toBeVisible();
});
