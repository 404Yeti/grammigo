import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceRecorder } from "./VoiceRecorder";

afterEach(() => vi.unstubAllGlobals());

describe("VoiceRecorder: microphone unavailable", () => {
  it("explains a denied permission, offers typing, and never hands over audio", async () => {
    const onAudio = vi.fn();
    vi.stubGlobal("MediaRecorder", class { static isTypeSupported = () => true; });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
    });

    render(<VoiceRecorder onAudio={onAudio} />);
    await userEvent.click(screen.getByRole("button", { name: /speak it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/can’t use the microphone/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/type instead/i);
    expect(onAudio).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /speak it/i })).toBeEnabled(); // can retry after allowing it
  });

  it("explains an unsupported browser the same honest way", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    render(<VoiceRecorder onAudio={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /speak it/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
