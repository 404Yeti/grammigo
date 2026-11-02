import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useVoiceCapture } from "@/features/ai/use-voice-capture";

const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  if (original) Object.defineProperty(navigator, "mediaDevices", original);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

it.each(["cancel", "unmount"] as const)("releases a late permission grant after %s without starting a recorder", async (action) => {
  let permit!: (stream: MediaStream) => void;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(() => new Promise(resolve => { permit = resolve; })) } });
  const Recorder = vi.fn();
  vi.stubGlobal("MediaRecorder", Recorder);
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const { result, unmount } = renderHook(useVoiceCapture);
  let pending!: ReturnType<typeof result.current.start>;
  const done = vi.fn();
  act(() => { pending = result.current.start(done); });
  if (action === "cancel") act(() => result.current.cancel());
  else unmount();
  await act(async () => { permit(stream); await pending; });
  expect(stop).toHaveBeenCalledOnce();
  expect(Recorder).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});
