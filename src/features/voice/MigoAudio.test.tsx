import "@/tests/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MigoAudio } from "./MigoAudio";
import { setMigoMuted } from "./preference";

const play = vi.fn().mockResolvedValue(undefined), pause = vi.fn();
const input = { lessonId: "present-perfect-vs-past-simple", questionId: "q1", kind: "instruction" } as const;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MIGO_VOICE", "true");
  setMigoMuted(false); vi.clearAllMocks();
  vi.stubGlobal("Audio", class { onended = null; onerror = null; play = play; pause = pause; });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "audio/mpeg" }), blob: async () => new Blob(["test-audio"], { type: "audio/mpeg" }) })));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:public-authored-audio");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); localStorage.clear(); });

it("is absent by default and never requests or plays audio during navigation", () => {
  vi.stubEnv("NEXT_PUBLIC_MIGO_VOICE", "");
  render(<MigoAudio {...input} />);
  expect(screen.queryByTestId("migo-audio")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
});
it("requires an explicit play action and replays cached public audio without another paid request", async () => {
  render(<MigoAudio {...input} />);
  expect(fetch).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  expect(screen.getByText(/AI-generated/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Listen to Migo" }));
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Replay Migo" }));
  await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledOnce();
  const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
  expect(body).toEqual(input);
});
it("honors persisted mute, stops current audio, and does not resume automatically when unmuted", async () => {
  act(() => setMigoMuted(true));
  render(<MigoAudio {...input} questionId="q2" />);
  expect(screen.getByRole("button", { name: "Listen to Migo" })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Unmute Migo" }));
  expect(play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Listen to Migo" }));
  await waitFor(() => expect(play).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Mute Migo" }));
  expect(pause).toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("grammigo:audio:v1")!)).toEqual({ version: 1, muted: true });
});
it("keeps learning usable when the service is unavailable", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  render(<MigoAudio {...input} questionId="q3" />);
  fireEvent.click(screen.getByRole("button", { name: "Listen to Migo" }));
  expect(await screen.findByText(/Audio is unavailable/)).toBeInTheDocument();
  expect(play).not.toHaveBeenCalled();
});
