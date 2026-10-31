import { afterEach, describe, expect, it, vi } from "vitest";
import { guidedVisible, guidedVoiceEnabled } from "./visibility";

afterEach(() => vi.unstubAllEnvs());

describe("Guided Correction stays hidden in production until the release gate is clear", () => {
  it("a production build hides it by default (v0.2 production is unaffected)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "");
    expect(guidedVisible()).toBe(false);
  });
  it("a preview build can opt in; development and tests always see it", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "true");
    expect(guidedVisible()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(guidedVisible()).toBe(true);
  });
});

describe("spoken answers are a separate switch, off in production until real-device testing", () => {
  it("a production build is typed-only by default; a build can opt in; development always has voice", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GUIDED_VOICE", "");
    expect(guidedVoiceEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GUIDED_VOICE", "true");
    expect(guidedVoiceEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_GUIDED_VOICE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(guidedVoiceEnabled()).toBe(true);
  });
  it("enabling the activity does not enable voice, and the release gate is unaffected by either switch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "true");
    vi.stubEnv("NEXT_PUBLIC_GUIDED_VOICE", "");
    expect(guidedVisible()).toBe(true);
    expect(guidedVoiceEnabled()).toBe(false);
    const { guidedReleaseStatus } = await import("./release");
    expect(guidedReleaseStatus().releasable).toBe(false);
    expect(guidedReleaseStatus().blockers).toHaveLength(5);
  });
});
