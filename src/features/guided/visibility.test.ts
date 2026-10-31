import { afterEach, describe, expect, it, vi } from "vitest";
import { guidedVisible } from "./visibility";

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
