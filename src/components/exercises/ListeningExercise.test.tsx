import "@/tests/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getLesson } from "@/data/lessons";
import { ListeningExercise } from "./ListeningExercise";
vi.mock("@/features/voice/MigoAudio", () => ({ MigoAudio: () => <button>Listen to Migo</button> }));
afterEach(cleanup);
const question = { ...getLesson("present-perfect-vs-past-simple")!.questions[0], listening: { transcript: "An authored listening scenario." } };
it("keeps the transcript out of the DOM until explicit accessible fallback or an answer", () => {
  const props = { lessonId: "present-perfect-vs-past-simple", question, value: "", disabled: false, onChange: vi.fn() };
  const view = render(<ListeningExercise {...props} />);
  expect(screen.queryByText(question.listening.transcript)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Read instead/ }));
  expect(screen.getByText(question.listening.transcript)).toBeVisible();
  view.unmount();
  render(<ListeningExercise {...props} disabled value="b" />);
  expect(screen.getByRole("heading", { name: "What Migo said" })).toBeVisible();
  expect(screen.getByText(question.listening.transcript)).toBeVisible();
});
