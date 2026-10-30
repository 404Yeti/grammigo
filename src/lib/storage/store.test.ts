import { beforeEach, describe, expect, it } from "vitest";
import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import { practiceActions, startSession } from "@/features/practice/actions";
import { getActiveSession, getCompletedSessions, getLatestCompleted } from "@/features/practice/selectors";
import { getSnapshot, resetStoreCache } from "./store";
import { parseStoredState, STORAGE_KEY } from "./schema";

beforeEach(() => resetStoreCache());

describe("persistence", () => {
  it("persists a started session and reloads it (simulating a refresh)", () => {
    const id = startSession(lesson, 1000);
    practiceActions.setDraft(id, "b");
    practiceActions.submit(id, lesson);

    resetStoreCache(); // a refresh drops in-memory state; localStorage remains
    const state = getSnapshot();
    const active = getActiveSession(state, lesson.id)!;
    expect(active.id).toBe(id);
    expect(active.phase).toBe("feedback");
    expect(active.records[0].classification).toBe("correct_first_try");
  });

  it("starting again creates a new session without touching a completed attempt", () => {
    const first = startSession(lesson, 1000);
    // complete it by hand
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    raw.sessions[0].status = "completed";
    raw.sessions[0].completedAt = 5000;
    raw.activeSessionId = null;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    resetStoreCache();

    const second = startSession(lesson, 6000);
    expect(second).not.toBe(first);
    const state = getSnapshot();
    expect(getCompletedSessions(state, lesson.id)).toHaveLength(1);
    expect(getLatestCompleted(state, lesson.id)!.id).toBe(first);
    expect(getActiveSession(state, lesson.id)!.id).toBe(second);
  });

  it("abandons an unfinished session when a new one starts", () => {
    const a = startSession(lesson, 1);
    const b = startSession(lesson, 2);
    const state = getSnapshot();
    expect(state.sessions.find((s) => s.id === a)!.status).toBe("abandoned");
    expect(state.activeSessionId).toBe(b);
  });

  it("clears the active session once completed", () => {
    const id = startSession(lesson, 1);
    for (let i = 0; i < 8; i++) {
      const answers = ["b", "watched", "a", "I saw that film yesterday", "They have lived here since 2018", "left", "I have been learning English since 2020", "I have read two books this week. I watched a film yesterday."];
      practiceActions.setDraft(id, answers[i]);
      practiceActions.submit(id, lesson);
      practiceActions.advance(id);
    }
    const state = getSnapshot();
    expect(state.activeSessionId).toBeNull();
    expect(getLatestCompleted(state, lesson.id)!.status).toBe("completed");
  });
});

describe("validation", () => {
  it("rejects malformed JSON, wrong versions and bad shapes", () => {
    expect(parseStoredState(null)).toBeNull();
    expect(parseStoredState("{not json")).toBeNull();
    expect(parseStoredState(JSON.stringify({ version: 99, sessions: [] }))).toBeNull();
    expect(parseStoredState(JSON.stringify({ version: 1, sessions: "nope" }))).toBeNull();
  });

  it("drops invalid sessions but keeps valid ones", () => {
    startSession(lesson, 1);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    raw.sessions.push({ id: "bad" });
    const parsed = parseStoredState(JSON.stringify(raw))!;
    expect(parsed.sessions).toHaveLength(1);
  });

  it("starts fresh and keeps a copy when stored data is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "{broken");
    resetStoreCache();
    expect(getSnapshot().sessions).toEqual([]);
    expect(window.localStorage.getItem(`${STORAGE_KEY}:corrupt`)).toBe("{broken");
  });
});
