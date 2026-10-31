import { describe, expect, it } from "vitest";
import { readAiConfig } from "./config";

// Measured upload sizes for a full 30 s recording at the recorder's 32 kbps (see VoiceRecorder).
const MEASURED_30S_BYTES = { chromium: 121_563, firefox: 136_477 };

describe("audio upload limit matches the intended 30-second recording", () => {
  const { audioBytesMax } = readAiConfig({}).limits;

  it("accepts a full 30 s recording from every measured browser with headroom", () => {
    for (const bytes of Object.values(MEASURED_30S_BYTES)) expect(audioBytesMax).toBeGreaterThan(bytes * 1.5);
  });

  it("does not allow a multi-minute upload (cost control: ≤ ~90 s at 32 kbps)", () => {
    const secondsAt32kbps = (audioBytesMax * 8) / 32_000;
    expect(secondsAt32kbps).toBeLessThanOrEqual(90);
  });
});
