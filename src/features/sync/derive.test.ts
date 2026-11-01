import "@/tests/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveLearning } from "@/features/learning/derive";
import { startGuidedSession, dispatchGuided } from "@/features/guided/store/actions";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { getSnapshot } from "@/lib/storage/store";
import { playQuestions, resetApp } from "@/tests/helpers";
import type { StoredState } from "@/types/session";
import { canonical } from "./canonical";
import { adoptGuided } from "./merge-guided";
import { adoptLessons } from "./merge";

/**
 * Mastery, the learning profile and recommendations are never saved or merged. They are derived, by the same deterministic code as always,
 * from the merged sessions. So two devices that sync arrive at identical mastery, and Guided Correction (a separate document) cannot reach it.
 */
const NOW = 1_800_000_000_000;
const snapshotOf = (s: StoredState) => {
  const l = deriveLearning(s, NOW);
  return canonical({ mastery: [...l.mastery.entries()], profile: l.profile, recommendations: l.recommendations, top: l.top, events: l.events });
};

function device(play: () => void): StoredState {
  resetApp();
  play();
  return JSON.parse(JSON.stringify(getSnapshot())) as StoredState;
}

beforeEach(() => {
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
});

describe("mastery after syncing", () => {
  it("is the same on both devices, whichever merged first, and however many times they sync", () => {
    const phone = device(() => playQuestions(8));
    const laptop = device(() => playQuestions(8, { stumbleOnQ2: true }));
    expect(phone.sessions[0].id).not.toBe(laptop.sessions[0].id);
    const onPhone = adoptLessons(phone, laptop);
    const onLaptop = adoptLessons(laptop, phone);
    expect(snapshotOf(onPhone)).toBe(snapshotOf(onLaptop));
    expect(snapshotOf(adoptLessons(onPhone, laptop))).toBe(snapshotOf(onPhone)); // syncing again changes nothing
    expect(snapshotOf(adoptLessons(adoptLessons(onPhone, phone), laptop))).toBe(snapshotOf(onPhone));
    expect(snapshotOf(onPhone).length).toBeGreaterThan(1_000); // a real, non-trivial result
  });

  it("uses ALL the evidence from both devices: it equals deriving from every session together", () => {
    const phone = device(() => playQuestions(8));
    const laptop = device(() => playQuestions(8, { stumbleOnQ2: true }));
    const together: StoredState = { ...phone, sessions: [...phone.sessions, ...laptop.sessions], activeSessionId: null };
    expect(deriveLearning(adoptLessons(phone, laptop), NOW).events.length).toBe(deriveLearning(together, NOW).events.length);
    expect(canonical([...deriveLearning(adoptLessons(phone, laptop), NOW).mastery.entries()])).toBe(canonical([...deriveLearning(together, NOW).mastery.entries()]));
  });

  it("is never changed by Guided Correction activity, however much is merged in from any device", () => {
    const lessons = device(() => playQuestions(8));
    const before = snapshotOf(lessons);
    // guided activity on two devices, merged as its own document
    const guidedA = (() => {
      resetGuidedStoreCache();
      window.localStorage.clear();
      startGuidedSession({ now: NOW, id: "ga" });
      dispatchGuided("ga", { type: "EDIT", draft: "I have watched a film yesterday evening." }, { now: NOW + 1, aiAvailable: true });
      dispatchGuided("ga", { type: "SUBMIT" }, { now: NOW + 2, aiAvailable: true });
      return JSON.parse(JSON.stringify(getGuidedSnapshot()));
    })();
    const guidedB = (() => {
      resetGuidedStoreCache();
      window.localStorage.clear();
      startGuidedSession({ now: NOW + 50, id: "gb" });
      dispatchGuided("gb", { type: "SHOW_ME" }, { now: NOW + 51 });
      return JSON.parse(JSON.stringify(getGuidedSnapshot()));
    })();
    const merged = adoptGuided(guidedA, guidedB);
    expect(merged.sessions.map((s: { id: string }) => s.id).sort()).toEqual(["ga", "gb"]);
    expect(snapshotOf(lessons)).toBe(before);
    expect(snapshotOf(adoptLessons(lessons, lessons))).toBe(before);
  });
});
