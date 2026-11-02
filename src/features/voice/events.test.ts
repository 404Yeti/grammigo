import { afterEach, expect, it } from "vitest";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { armCelebration, claimAutomaticSpeech, pendingCelebration } from "./events";

afterEach(() => { setStorageScope(""); sessionStorage.clear(); });
it("keeps playback markers separate from progress and isolated between learner scopes", () => {
  const event = crypto.randomUUID();
  expect(claimAutomaticSpeech(event)).toBe(true);
  expect(claimAutomaticSpeech(event)).toBe(false);
  setStorageScope("11111111-1111-4111-8111-111111111111");
  expect(claimAutomaticSpeech(event)).toBe(true);
  expect(claimAutomaticSpeech(event)).toBe(false);
  expect(localStorage.getItem("grammigo:v2")).toBeNull();
});
it("only arms the matching freshly completed session", () => {
  expect(pendingCelebration("old")).toBeUndefined();
  armCelebration("fresh");
  expect(pendingCelebration("fresh")).toBe("complete:fresh");
  expect(pendingCelebration("old")).toBeUndefined();
});
