import { beforeEach, describe, expect, it } from "vitest";
import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import { advance, createSession, setDraft, submitAnswer } from "@/features/practice/session";
import { getSnapshot, resetStoreCache, updateState } from "./store";
import { LEGACY_STORAGE_KEY, STORAGE_KEY, defaultOnboarding, emptyState, migrateV1ToV2, parseStoredState } from "./schema";
import type { Session } from "@/types/session";

const ANSWERS = [
  "b", "watched", "a", "I saw that film yesterday", "They have lived here since 2018", "left",
  "I have been learning English since 2020", "I have read two books this week. I watched a film yesterday.",
];

/** A finished v0.1 attempt, built with the same pure functions v0.1 used. */
function completedV01Session(): Session {
  let s = createSession(lesson, "v01-session", 1_000_000);
  ANSWERS.forEach((a, i) => {
    s = setDraft(s, a, 1_000_000 + i * 20_000);
    s = submitAnswer(s, lesson, 1_000_000 + i * 20_000 + 500).session;
    s = advance(s, 1_000_000 + i * 20_000 + 900);
  });
  return s;
}

const v1Doc = (sessions: Session[], active: string | null = null) =>
  JSON.stringify({ version: 1, sessions, activeSessionId: active });

beforeEach(() => {
  window.localStorage.clear();
  resetStoreCache();
});

describe("v1 → v2 migration", () => {
  it("preserves a completed v0.1 session exactly, including original attempt history", () => {
    const original = completedV01Session();
    expect(original.status).toBe("completed");
    const migrated = parseStoredState(v1Doc([original]))!;
    expect(migrated.version).toBe(2);
    expect(migrated.sessions).toEqual([original]);
    expect(migrated.sessions[0].records.map((r) => r.classification)).toEqual(Array(8).fill("correct_first_try"));
  });

  it("preserves an in-progress v0.1 session and keeps it active", () => {
    let s = createSession(lesson, "mid", 5);
    s = setDraft(s, "b", 6);
    const migrated = parseStoredState(v1Doc([s], "mid"))!;
    expect(migrated.activeSessionId).toBe("mid");
    expect(migrated.sessions[0].draft).toBe("b");
  });

  it("adds the new v2 fields with safe defaults", () => {
    const migrated = parseStoredState(v1Doc([completedV01Session()]))!;
    expect(migrated.goals).toBeNull();
    expect(migrated.diagnosticRuns).toEqual([]);
    expect(migrated.lastRecommendation).toBeNull();
    expect(migrated.writingFeedback).toEqual({});
  });

  it("does not force an existing v0.1 learner through onboarding", () => {
    expect(parseStoredState(v1Doc([completedV01Session()]))!.onboarding.status).toBe("skipped");
  });

  it("treats a v1 document with no sessions as a brand-new learner", () => {
    expect(parseStoredState(v1Doc([]))!.onboarding.status).toBe("not_started");
  });

  it("drops only invalid sessions", () => {
    const doc = JSON.stringify({ version: 1, sessions: [completedV01Session(), { id: "bad" }], activeSessionId: null });
    expect(parseStoredState(doc)!.sessions).toHaveLength(1);
  });

  it("migrateV1ToV2 is pure and leaves its input alone", () => {
    const v1 = { version: 1 as const, sessions: [completedV01Session()], activeSessionId: null };
    const copy = JSON.parse(JSON.stringify(v1));
    migrateV1ToV2(v1);
    expect(v1).toEqual(copy);
  });
});

describe("store migration from localStorage", () => {
  it("reads v0.1 data when no v2 data exists, and keeps the v0.1 copy as a backup", () => {
    const original = completedV01Session();
    window.localStorage.setItem(LEGACY_STORAGE_KEY, v1Doc([original]));
    const state = getSnapshot();
    expect(state.version).toBe(2);
    expect(state.sessions).toEqual([original]);

    updateState((s) => s); // first write persists v2
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(v1Doc([original]));
  });

  it("prefers v2 data over v0.1 data once it exists", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, v1Doc([completedV01Session()]));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyState()));
    resetStoreCache();
    expect(getSnapshot().sessions).toEqual([]);
  });

  it("keeps unreadable data aside instead of destroying it", () => {
    window.localStorage.setItem(STORAGE_KEY, "{broken");
    resetStoreCache();
    expect(getSnapshot().sessions).toEqual([]);
    expect(window.localStorage.getItem(`${STORAGE_KEY}:corrupt`)).toBe("{broken");
  });
});

describe("v2 validation", () => {
  it("round-trips a full v2 document", () => {
    const state = { ...emptyState(), sessions: [completedV01Session()] };
    expect(parseStoredState(JSON.stringify(state))).toEqual(state);
  });

  it("falls back to defaults for malformed onboarding data without losing sessions", () => {
    const state = { ...emptyState(), sessions: [completedV01Session()], onboarding: { step: "nonsense" } };
    const parsed = parseStoredState(JSON.stringify(state))!;
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.onboarding).toEqual(defaultOnboarding());
  });

  it("drops malformed diagnostic runs but keeps valid ones", () => {
    const good = { id: "r1", startedAt: 1, finishedAt: null, goalSkillIds: [], extended: false, responses: [] };
    const state = { ...emptyState(), diagnosticRuns: [good, { id: 5 }] };
    expect(parseStoredState(JSON.stringify(state))!.diagnosticRuns).toEqual([good]);
  });

  it("rejects unknown future versions", () => {
    expect(parseStoredState(JSON.stringify({ version: 3, sessions: [] }))).toBeNull();
  });
});
