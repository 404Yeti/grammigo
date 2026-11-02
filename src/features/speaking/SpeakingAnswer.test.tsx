import "@/tests/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "@/features/ai/use-voice-capture";
import { SpeakingAnswer } from "./SpeakingAnswer";

const mock = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), transcribe: vi.fn(), status: vi.fn(),
}));
vi.mock("@/features/ai/client", () => ({ fetchAiStatus: mock.status, requestTranscription: mock.transcribe }));
vi.mock("@/features/ai/use-voice-capture", () => ({ useVoiceCapture: () => ({ listening: true, seconds: 2, start: mock.start, stop: mock.stop, cancel: mock.cancel }) }));
let done: (result: CaptureResult) => void;
const audio = { ok: true, blob: new Blob(["audio"], { type: "audio/webm" }) } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mock.status.mockResolvedValue({ available: true });
  mock.transcribe.mockResolvedValue("I have visited Paris this week. I watched a film yesterday.");
  mock.start.mockImplementation(async (callback) => { done = callback; return { ok: true }; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function begin() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Record an answer" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Record an answer" }));
  await screen.findByRole("button", { name: "Stop recording" });
}

describe("reviewed lesson speech", () => {
  it("does not give the lesson an unconfirmed transcript; corrected words are committed only after explicit confirmation", async () => {
    const change = vi.fn(), busy = vi.fn();
    render(<SpeakingAnswer value="" onChange={change} onBusyChange={busy} disabled={false} />);
    await begin();
    await act(async () => { done(audio); });
    const field = await screen.findByRole("textbox", { name: "What we heard" });
    expect(change).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(true);
    fireEvent.change(field, { target: { value: "I have read a book this week. I visited my friend yesterday." } });
    fireEvent.click(screen.getByRole("button", { name: "Use this transcript" }));
    expect(change).toHaveBeenCalledWith("I have read a book this week. I visited my friend yesterday.");
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it("keeps typing available without an API, and never opens the microphone automatically", async () => {
    mock.status.mockResolvedValue({ available: false });
    const change = vi.fn();
    render(<SpeakingAnswer value="" onChange={change} disabled={false} />);
    await screen.findByText(/Recording is unavailable/);
    expect(mock.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "Typed answer" } });
    expect(change).toHaveBeenCalledWith("Typed answer");
  });

  it.each(["permission_denied", "unsupported", "no_speech"] as const)("offers typing after %s", async (reason) => {
    mock.start.mockResolvedValue({ ok: false, reason });
    render(<SpeakingAnswer value="" onChange={vi.fn()} disabled={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Record an answer" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Record an answer" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeEnabled();
  });

  it("ignores and aborts a cancelled late transcription, retaining the prior typed answer", async () => {
    let finish!: (text: string) => void;
    mock.transcribe.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const change = vi.fn();
    render(<SpeakingAnswer value="previous draft" onChange={change} disabled={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Record again" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    await screen.findByRole("button", { name: "Stop recording" });
    act(() => { done(audio); });
    await screen.findByText(/Turning your recording/);
    const signal = mock.transcribe.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel and type instead" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { finish("late private transcript"); });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("previous draft");
  });

  it("treats empty or failed transcription as a service problem, never as a grammar mistake", async () => {
    mock.transcribe.mockResolvedValue("");
    const change = vi.fn();
    render(<SpeakingAnswer value="" onChange={change} disabled={false} />);
    await begin();
    await act(async () => { done(audio); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t turn that recording/);
    expect(change).not.toHaveBeenCalled();
  });

  it("cancels a pending permission request after ten seconds and ignores a later result", async () => {
    let finish!: (result: { ok: true }) => void;
    mock.start.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<SpeakingAnswer value="" onChange={vi.fn()} disabled={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Record an answer" })).toBeEnabled());
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Record an answer" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent(/took too long/);
    expect(mock.cancel).toHaveBeenCalled();
    await act(async () => { finish({ ok: true }); });
    expect(screen.queryByRole("button", { name: "Stop recording" })).not.toBeInTheDocument();
  });
});
