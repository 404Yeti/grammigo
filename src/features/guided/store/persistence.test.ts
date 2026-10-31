import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "@/features/practice/session";
import { getLesson } from "@/data/lessons";
import { getSnapshot as getLessonSnapshot, resetStoreCache as resetLessonStore, updateState as updateLessonState } from "@/lib/storage/store";
import { LEGACY_STORAGE_KEY, STORAGE_KEY, emptyState } from "@/lib/storage/schema";
import { GUIDED_STORE_VERSION, type GuidedSession } from "@/types/guided";
import { createGuidedSession } from "../cycle/machine";
import { summarizeOutcomes } from "../cycle/outcome";
import { GUIDED_STORAGE_KEY, capSessions, emptyGuidedState, parseGuidedState } from "./schema";
import { activeGuidedSession, dispatchGuided, seenItemIds, startGuidedSession } from "./actions";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence, subscribeGuided, updateGuided, type GuidedPersistence } from "./store";

const T0 = 1_800_000_000_000;
const GOOD = "I watched a film with my sister.";
const BAD = "I have watched a film yesterday evening.";

beforeEach(() => {
  window.localStorage.clear();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
});

const raw = () => window.localStorage.getItem(GUIDED_STORAGE_KEY);
const reload = () => {
  resetGuidedStoreCache();
  return getGuidedSnapshot();
};
const doc = (sessions: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ version: GUIDED_STORE_VERSION, sessions, activeSessionId: null, ...over });

describe("starting, saving and resuming", () => {
  it("is empty at first, and saves under its own key only", () => {
    expect(getGuidedSnapshot()).toEqual(emptyGuidedState());
    expect(raw()).toBeNull();
    const s = startGuidedSession({ now: T0, id: "g1" });
    expect(s.id).toBe("g1");
    expect(window.localStorage.length).toBe(1);
    expect(parseGuidedState(raw())).toMatchObject({ kind: "ok", state: { activeSessionId: "g1" } });
  });

  it("resumes the session in progress instead of forking a second one", () => {
    const a = startGuidedSession({ now: T0, id: "g1" });
    const b = startGuidedSession({ now: T0 + 5000, id: "g2" });
    expect(b.id).toBe(a.id);
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
    dispatchGuided("g1", { type: "ABANDON" }, { now: T0 + 6000 });
    expect(activeGuidedSession(getGuidedSnapshot())).toBeNull();
    expect(startGuidedSession({ now: T0 + 7000, id: "g3" }).id).toBe("g3");
    expect(getGuidedSnapshot().sessions.map((s) => s.status)).toEqual(["abandoned", "in_progress"]);
  });

  it("every accepted event is saved, and a reload returns exactly the same state", () => {
    startGuidedSession({ now: T0, id: "g1" });
    dispatchGuided("g1", { type: "EDIT", draft: BAD }, { now: T0 + 1 });
    dispatchGuided("g1", { type: "SUBMIT" }, { now: T0 + 2 });
    dispatchGuided("g1", { type: "REQUEST_HINT" }, { now: T0 + 3 });
    const before = getGuidedSnapshot();
    expect(reload()).toEqual(before);
  });

  it("resumes mid-ladder after a refresh: rung, hints, attempts and the draft are all still there", () => {
    startGuidedSession({ now: T0, id: "g1" });
    dispatchGuided("g1", { type: "EDIT", draft: BAD }, { now: T0 + 1 });
    dispatchGuided("g1", { type: "SUBMIT" }, { now: T0 + 2 });
    dispatchGuided("g1", { type: "REQUEST_HINT" }, { now: T0 + 3 });
    dispatchGuided("g1", { type: "EDIT", draft: "I have cooked" }, { now: T0 + 4 });
    const ex = reload().sessions[0].exercises[0];
    expect(ex).toMatchObject({ phase: "repairing", rung: 2, hintsUsed: 1, retriesUsed: 0, draft: "I have cooked", category: "pp_with_finished_time" });
    expect(ex.attempts).toHaveLength(1);
    expect(ex.ladder).toMatchObject({ marker: "yesterday", aux: "have", verb: "watched" });
  });

  it("rejected events are not saved and do not disturb anything", () => {
    startGuidedSession({ now: T0, id: "g1" });
    const before = raw();
    const out = dispatchGuided("g1", { type: "REQUEST_HINT" }, { now: T0 + 1 });
    expect(out.rejected).toBe("hint_not_available");
    expect(raw()).toBe(before);
    expect(dispatchGuided("nope", { type: "SHOW_ME" }, { now: T0 + 2 }).rejected).toBe("unknown_session");
  });

  it("completed work is kept, an in-progress marker is cleared, and seen items feed transfer rotation", () => {
    startGuidedSession({ now: T0, id: "g1" });
    dispatchGuided("g1", { type: "EDIT", draft: GOOD }, { now: T0 + 1 });
    dispatchGuided("g1", { type: "SUBMIT" }, { now: T0 + 2 });
    dispatchGuided("g1", { type: "CONTINUE" }, { now: T0 + 3 });
    dispatchGuided("g1", { type: "START_TRANSFER" }, { now: T0 + 4 });
    dispatchGuided("g1", { type: "SKIP_TRANSFER" }, { now: T0 + 5 }); // rejected: already in transfer
    dispatchGuided("g1", { type: "SHOW_ME" }, { now: T0 + 6 });
    dispatchGuided("g1", { type: "CONTINUE" }, { now: T0 + 7 });
    dispatchGuided("g1", { type: "FINISH" }, { now: T0 + 8 });
    const s = reload();
    expect(s.activeSessionId).toBeNull();
    expect(s.sessions[0]).toMatchObject({ status: "completed", stage: "done" });
    expect(seenItemIds(s)).toEqual(["ppps-main", "ppps-transfer-unfinished"]);
    startGuidedSession({ now: T0 + 9, id: "g2" });
    dispatchGuided("g2", { type: "EDIT", draft: GOOD }, { now: T0 + 10 });
    dispatchGuided("g2", { type: "SUBMIT" }, { now: T0 + 11 });
    dispatchGuided("g2", { type: "CONTINUE" }, { now: T0 + 12 });
    dispatchGuided("g2", { type: "START_TRANSFER" }, { now: T0 + 13 });
    expect(getGuidedSnapshot().sessions[1].exercises[1].itemId).not.toBe("ppps-transfer-unfinished"); // rotated
  });
});

describe("what survives a refresh, and what cannot", () => {
  const withPhase = (patch: Record<string, unknown>) => {
    const s = createGuidedSession("g1", T0);
    return doc([{ ...s, exercises: [{ ...s.exercises[0], ...patch }] }], { activeSessionId: "g1" });
  };

  it("a transcript waiting to be confirmed is still waiting", () => {
    window.localStorage.setItem(GUIDED_STORAGE_KEY, withPhase({ phase: "confirming", returnPhase: "attempting", inputMode: "spoken", draft: "I went out.", pendingTranscript: { raw: "I went out.", edited: false, lowConfidenceWords: ["went"] } }));
    const ex = getGuidedSnapshot().sessions[0].exercises[0];
    expect(ex).toMatchObject({ phase: "confirming", draft: "I went out.", pendingTranscript: { lowConfidenceWords: ["went"] } });
    expect(ex.attempts).toHaveLength(0); // still not judged
  });

  it("a recording in progress cannot resume: the learner is returned to where they were, with nothing counted", () => {
    for (const phase of ["recording", "transcribing"]) {
      resetGuidedStoreCache();
      window.localStorage.setItem(GUIDED_STORAGE_KEY, withPhase({ phase, returnPhase: "attempting", inputMode: "spoken" }));
      expect(getGuidedSnapshot().sessions[0].exercises[0], phase).toMatchObject({ phase: "attempting", attempts: [], outcome: null });
    }
  });

  it("a second opinion that was in flight is gone: the answer is simply left unverified, with no penalty", () => {
    window.localStorage.setItem(GUIDED_STORAGE_KEY, withPhase({ phase: "checking_opinion", returnPhase: "checking_opinion", opinionsUsed: 1 }));
    expect(getGuidedSnapshot().sessions[0].exercises[0]).toMatchObject({ phase: "unverified", unverifiedReason: "opinion_interrupted", outcome: null, retriesUsed: 0 });
  });

  it("a confirm step with no transcript falls back to a fresh attempt", () => {
    window.localStorage.setItem(GUIDED_STORAGE_KEY, withPhase({ phase: "confirming", pendingTranscript: null }));
    expect(getGuidedSnapshot().sessions[0].exercises[0].phase).toBe("attempting");
  });
});

describe("bad data is handled safely", () => {
  it("unreadable data is set aside (not destroyed) and the learner starts clean", () => {
    window.localStorage.setItem(GUIDED_STORAGE_KEY, "{not json");
    expect(getGuidedSnapshot()).toEqual(emptyGuidedState());
    expect(window.localStorage.getItem(`${GUIDED_STORAGE_KEY}:corrupt`)).toBe("{not json");
    startGuidedSession({ now: T0, id: "g1" });
    expect(window.localStorage.getItem(`${GUIDED_STORAGE_KEY}:corrupt`)).toBe("{not json"); // still kept
  });

  it("the wrong shape is treated the same way", () => {
    for (const bad of ["null", "[]", '"x"', '{"version":1}', '{"version":1,"sessions":"x"}', '{"version":0,"sessions":[]}']) {
      expect(parseGuidedState(bad).kind, bad).toBe("corrupt");
    }
  });

  it("a document written by a NEWER app is neither read nor overwritten", () => {
    const future = JSON.stringify({ version: 99, sessions: [{ anything: true }] });
    window.localStorage.setItem(GUIDED_STORAGE_KEY, future);
    expect(getGuidedSnapshot()).toEqual(emptyGuidedState());
    const s = startGuidedSession({ now: T0, id: "g1" });
    expect(s.id).toBe("g1"); // the app still works, in memory
    dispatchGuided("g1", { type: "EDIT", draft: GOOD }, { now: T0 + 1 });
    expect(raw()).toBe(future); // untouched
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
  });

  it("one damaged session is dropped; the others are kept", () => {
    const ok = createGuidedSession("ok", T0);
    const parsed = parseGuidedState(doc([ok, { id: "bad" }, { ...ok, id: "bad2", exercises: [] }, { ...ok, id: "bad3", stage: "nonsense" }]));
    expect(parsed).toMatchObject({ kind: "ok", dropped: 3 });
    if (parsed.kind === "ok") expect(parsed.state.sessions.map((s) => s.id)).toEqual(["ok"]);
  });

  it("an exercise that claims an outcome it does not have is dropped", () => {
    const s = createGuidedSession("x", T0);
    const bad1 = { ...s, id: "b1", exercises: [{ ...s.exercises[0], phase: "resolved" }] }; // resolved with no outcome
    const bad2 = { ...s, id: "b2", exercises: [{ ...s.exercises[0], outcome: { kind: "first_try", basis: "none", source: null, at: 1 } }] }; // outcome while not resolved
    expect(parseGuidedState(doc([bad1, bad2]))).toMatchObject({ kind: "ok", dropped: 2 });
  });

  it("text is clamped, counters are bounded, and unknown enum values are ignored", () => {
    const s = createGuidedSession("x", T0);
    const ex = { ...s.exercises[0], retriesUsed: 9999, opinionsUsed: -5, hintsUsed: 77, rung: 42, category: "made_up", voiceIssue: "made_up", draft: "x".repeat(5000) };
    const out = parseGuidedState(doc([{ ...s, exercises: [ex] }]));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      const e = out.state.sessions[0].exercises[0];
      expect(e).toMatchObject({ retriesUsed: 10, opinionsUsed: 0, hintsUsed: 2, rung: 0, category: null, voiceIssue: null });
      expect(e.draft.length).toBe(600);
    }
  });

  it("only one session can be in progress: the most recently used one is kept, the rest are closed", () => {
    const a = { ...createGuidedSession("a", T0), updatedAt: T0 + 10 };
    const b = { ...createGuidedSession("b", T0), updatedAt: T0 + 99 };
    const out = parseGuidedState(doc([a, b]));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.state.activeSessionId).toBe("b");
      expect(out.state.sessions.find((s) => s.id === "a")).toMatchObject({ status: "abandoned", stage: "done" });
    }
  });

  it("history is capped at 100 sessions: the oldest finished ones go first, an in-progress one never does", () => {
    const many: GuidedSession[] = Array.from({ length: 130 }, (_, i) => ({ ...createGuidedSession(`s${i}`, T0 + i), status: "abandoned" as const, stage: "done" as const, updatedAt: T0 + i }));
    many.push({ ...createGuidedSession("live", T0 - 1000), updatedAt: T0 - 1000 });
    const capped = capSessions(many);
    expect(capped).toHaveLength(100);
    expect(capped.some((s) => s.id === "live")).toBe(true);
    expect(capped.some((s) => s.id === "s0")).toBe(false);
    expect(capped.some((s) => s.id === "s129")).toBe(true);
  });
});

describe("storage that fails or changes under us", () => {
  it("a failed write keeps the learner going in memory, and the next change tries to save again", () => {
    let failures = 1;
    const mem = new Map<string, string>();
    const flaky: GuidedPersistence = {
      read: () => mem.get("k") ?? null,
      write: (s) => (failures-- > 0 ? false : (mem.set("k", s), true)),
      quarantine: () => undefined,
      subscribe: () => () => undefined,
    };
    setGuidedPersistence(flaky);
    startGuidedSession({ now: T0, id: "g1" }); // write fails
    expect(mem.has("k")).toBe(false);
    expect(getGuidedSnapshot().sessions).toHaveLength(1); // still there in memory
    dispatchGuided("g1", { type: "EDIT", draft: GOOD }, { now: T0 + 1 }); // write succeeds now
    expect(JSON.parse(mem.get("k")!).sessions[0].exercises[0].draft).toBe(GOOD);
  });

  it("another tab's change is picked up and listeners are told", () => {
    startGuidedSession({ now: T0, id: "g1" });
    let calls = 0;
    const off = subscribeGuided(() => calls++);
    window.localStorage.setItem(GUIDED_STORAGE_KEY, doc([{ ...createGuidedSession("other", T0 + 5), updatedAt: T0 + 5 }], { activeSessionId: "other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: GUIDED_STORAGE_KEY }));
    expect(calls).toBeGreaterThan(0);
    expect(getGuidedSnapshot().sessions.map((s) => s.id)).toEqual(["other"]);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: GUIDED_STORAGE_KEY }));
    expect(calls).toBe(1);
  });

  it("changes to other keys (the lesson document) do not wake guided listeners", () => {
    let calls = 0;
    const off = subscribeGuided(() => calls++);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(calls).toBe(0);
    off();
  });
});

describe("EXISTING LEARNER DATA IS UNTOUCHED", () => {
  const lessonDoc = () => {
    const lesson = getLesson("a1-present-simple")!;
    const session = { ...createSession(lesson, "lesson-1", T0), status: "completed" as const, completedAt: T0 + 1000 };
    return JSON.stringify({ ...emptyState(), sessions: [session], activeSessionId: null });
  };

  it("a full guided session leaves the v0.2 document and the v0.1 backup byte-for-byte identical", () => {
    const v2 = lessonDoc();
    const v1 = JSON.stringify({ version: 1, sessions: [], activeSessionId: null });
    window.localStorage.setItem(STORAGE_KEY, v2);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, v1);

    startGuidedSession({ now: T0, id: "g1" });
    const send = (e: Parameters<typeof dispatchGuided>[1], t: number) => dispatchGuided("g1", e, { now: T0 + t });
    send({ type: "EDIT", draft: BAD }, 1);
    send({ type: "SUBMIT" }, 2);
    send({ type: "REQUEST_HINT" }, 3);
    send({ type: "START_RECORDING" }, 4);
    send({ type: "TRANSCRIPT_FAILED", reason: "failed" }, 5);
    send({ type: "SHOW_ME" }, 6);
    send({ type: "CONTINUE" }, 7);
    send({ type: "START_TRANSFER" }, 8);
    send({ type: "SHOW_ME" }, 9);
    send({ type: "CONTINUE" }, 10);
    send({ type: "FINISH" }, 11);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(v2);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(v1);
    expect(Object.keys(window.localStorage).sort()).toEqual([GUIDED_STORAGE_KEY, LEGACY_STORAGE_KEY, STORAGE_KEY].sort());
  });

  it("the lesson store reads exactly the same state with or without guided history present", () => {
    window.localStorage.setItem(STORAGE_KEY, lessonDoc());
    resetLessonStore();
    const without = JSON.parse(JSON.stringify(getLessonSnapshot()));
    startGuidedSession({ now: T0, id: "g1" });
    dispatchGuided("g1", { type: "SHOW_ME" }, { now: T0 + 1 });
    resetLessonStore();
    expect(JSON.parse(JSON.stringify(getLessonSnapshot()))).toEqual(without);
  });

  it("writing lesson progress never changes guided history", () => {
    startGuidedSession({ now: T0, id: "g1" });
    dispatchGuided("g1", { type: "SHOW_ME" }, { now: T0 + 1 });
    const guidedBefore = raw();
    resetLessonStore();
    updateLessonState((s) => ({ ...s, writingFeedback: { x: { status: "unavailable", at: 1 } } }));
    expect(raw()).toBe(guidedBefore);
  });

  it("a learner with legacy v0.1 data and a v0.2 document simply starts with empty guided history: nothing is imported or converted", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ version: 1, sessions: [], activeSessionId: null }));
    window.localStorage.setItem(STORAGE_KEY, lessonDoc());
    expect(getGuidedSnapshot()).toEqual(emptyGuidedState());
    expect(parseGuidedState(null)).toEqual({ kind: "empty" });
  });
});

describe("activity outcomes are summarised from guided history only", () => {
  it("counts main and transfer separately, typed and spoken, and AI-confirmed, without any mastery input", () => {
    startGuidedSession({ now: T0, id: "g1" });
    const send = (e: Parameters<typeof dispatchGuided>[1], t: number) => dispatchGuided("g1", e, { now: T0 + t });
    send({ type: "EDIT", draft: BAD }, 1);
    send({ type: "SUBMIT" }, 2);
    send({ type: "EDIT", draft: GOOD }, 3);
    send({ type: "SUBMIT" }, 4); // self-corrected
    send({ type: "CONTINUE" }, 5);
    send({ type: "START_TRANSFER" }, 6);
    send({ type: "SHOW_ME" }, 7); // shown
    const sum = summarizeOutcomes(getGuidedSnapshot());
    expect(sum.main).toEqual({ first_try: 0, self_corrected: 1, hint_assisted: 0, shown: 0, unverified: 0 });
    expect(sum.transfer).toEqual({ first_try: 0, self_corrected: 0, hint_assisted: 0, shown: 1, unverified: 0 });
    expect(sum).toMatchObject({ typed: 1, spoken: 0, aiConfirmed: 0 });
    expect(sum.meanProvisionalValue).toBeCloseTo(0.35, 5); // (0.7 + 0) / 2: informational only
  });

  it("an empty history summarises to zeros and no mean", () => {
    expect(summarizeOutcomes(emptyGuidedState())).toMatchObject({ spoken: 0, typed: 0, aiConfirmed: 0, meanProvisionalValue: null });
  });

  it("unverified outcomes carry no value, so they can never pull a number down", () => {
    startGuidedSession({ now: T0, id: "g1" });
    const send = (e: Parameters<typeof dispatchGuided>[1], t: number, ai = false) => dispatchGuided("g1", e, { now: T0 + t, aiAvailable: ai });
    send({ type: "EDIT", draft: "I have watched a film." }, 1);
    send({ type: "SUBMIT" }, 2); // uncertain, AI unavailable → unverified phase
    send({ type: "ACCEPT_AS_IS" }, 3);
    const sum = summarizeOutcomes(getGuidedSnapshot());
    expect(sum.main.unverified).toBe(1);
    expect(sum.meanProvisionalValue).toBeNull();
  });
});

// keep the compiler honest about the helper used above
void updateGuided;
