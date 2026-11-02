import "@/tests/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OptionalSpeaking } from "./OptionalSpeaking";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/features/onboarding/actions", () => ({ saveOptionalSpeaking: save }));
vi.mock("@/features/speaking/SpeakingAnswer", () => ({ SpeakingAnswer: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) => <label>Confirmed answer<input value={value} onChange={e => onChange(e.target.value)} disabled={disabled} /></label> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("lets a learner skip without permission, network, or a paid service", () => {
  const done = vi.fn();
  render(<OptionalSpeaking runId="r" onDone={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip speaking" }));
  expect(save).toHaveBeenCalledWith("r", { version: 1, status: "skipped", at: expect.any(Number) });
  expect(done).toHaveBeenCalledOnce();
});
it("saves only the confirmed sample when the learner explicitly continues, with a chance to retry", () => {
  const done = vi.fn();
  render(<OptionalSpeaking runId="r" onDone={done} />);
  fireEvent.change(screen.getByLabelText("Confirmed answer"), { target: { value: "My favorite place are the park." } });
  fireEvent.click(screen.getByRole("button", { name: "Check my sentence" }));
  expect(screen.getByRole("status")).toHaveTextContent(/singular/);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try my sentence again" }));
  fireEvent.change(screen.getByLabelText("Confirmed answer"), { target: { value: "My favorite place is the park." } });
  fireEvent.click(screen.getByRole("button", { name: "Check my sentence" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to my results" }));
  expect(save).toHaveBeenCalledWith("r", expect.objectContaining({ answer: "My favorite place is the park.", observation: "pattern_seen" }));
  expect(done).toHaveBeenCalledOnce();
});
