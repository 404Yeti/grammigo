import { describe, expect, it } from "vitest";
import { deriveLearning } from "@/features/learning/derive";
import { learningActivity } from "@/features/activity/calendar";
import { emptyState, parseStoredState } from "@/lib/storage/schema";
import { PROGRESS_NOW as NOW, progressFixture, progressSession } from "@/tests/progress-fixtures";
import type { WritingFeedback } from "@/features/ai/schemas";
import { evidenceLabel, progressOverview, speakingObservation } from "./derive";

const derive = (state = progressFixture()) => progressOverview(state, deriveLearning(state, NOW), NOW);
const feedback: WritingFeedback = { outcome: "meets_goal", confidence: "high", errors: [], suggestedCorrection: null, explanation: "Target pattern seen.", example: null, assessedSkillIds: ["a1-be-present"] };

describe("Progress: real learning evidence", () => {
  it("has no invented strengths, completions, topics or placement for a new learner", () => {
    const result = derive(emptyState());
    expect(result).toMatchObject({ completedLessons: 0, completed: [], topics: [], levels: [] });
    expect(result).not.toHaveProperty("placement");
  });

  it("deduplicates completed lessons, retains repeat sessions and leaves persisted history untouched", () => {
    const state = progressFixture(); const before = JSON.stringify(state);
    const result = derive(state);
    expect(result.completedLessons).toBe(3);
    expect(result.completed.map(s => s.id)).toEqual(["unchecked", "review", "strong-two", "strong-one"]);
    expect(result.topics.map(t => t.skillId)).toContain("a2-comparatives");
    expect(result.levels).toEqual([{ level: "A1", topics: 2, completed: 2, checked: 16 }, { level: "A2", topics: 2, completed: 1, checked: 9 }]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("uses the calendar completion rule for unfinished, abandoned, future, invalid and missing dates", () => {
    const state = emptyState();
    const valid = progressSession("ok", "a1-be-present", NOW - 1000);
    state.sessions = [valid, { ...valid, id: "open", status: "in_progress" }, { ...valid, id: "left", status: "abandoned" }, { ...valid, id: "future", completedAt: NOW + 1 }, { ...valid, id: "missing", completedAt: null }, { ...valid, id: "invalid", completedAt: Infinity }];
    expect(derive(state).completed.map(s => s.id)).toEqual(["ok"]);
    expect(learningActivity(state.sessions, NOW, "Pacific/Kiritimati").totalActiveDays).toBe(1);
  });

  it("distinguishes checked strengths, review needs, thin diagnostics and unverified writing", () => {
    const entries = derive().topics;
    expect(evidenceLabel(entries.find(e => e.skillId === "a1-be-present")!)).toBe("Demonstrated strength");
    expect(evidenceLabel(entries.find(e => e.skillId === "a2-past-simple")!)).toBe("Worth reviewing");
    expect(evidenceLabel(entries.find(e => e.skillId === "a2-comparatives")!)).toBe("Early evidence");
    expect(evidenceLabel(entries.find(e => e.skillId === "a1-articles")!)).toBe("Not enough checked evidence");
    expect(entries.find(e => e.skillId === "a1-articles")!.mastery.incorrect).toBe(0);
  });

  it("keeps historical v1 completions and resolved work in an unfinished lesson separate", () => {
    const session = progressSession("old", "a1-be-present", Date.parse("2024-02-29T23:30Z"));
    const migrated = parseStoredState(JSON.stringify({version: 1, sessions: [session], activeSessionId: null}))!;
    expect(derive(migrated).completed[0]).toEqual(session);
    migrated.sessions[0] = { ...session, status: "in_progress", completedAt: null };
    const partial = derive(migrated);
    expect(partial.completedLessons).toBe(0); expect(partial.topics).toHaveLength(1);
    expect(partial.levels[0]).toMatchObject({completed:0,checked:8});
  });

  it("does not call one perfect lesson a demonstrated strength or one diagnostic miss a weakness", () => {
    const state = progressFixture(); state.sessions = state.sessions.slice(0,1);
    state.diagnosticRuns[0].responses[0].outcome = "incorrect";
    const topics = derive(state).topics;
    expect(evidenceLabel(topics.find(t => t.skillId === "a1-be-present")!)).toBe("Going well");
    expect(evidenceLabel(topics.find(t => t.skillId === "a2-comparatives")!)).toBe("Early evidence");
  });

  it("does not count skipped diagnostics or optional speaking observations as checked grammar", () => {
    const state = progressFixture(); state.sessions = [];
    state.diagnosticRuns[0].responses[0].outcome = "skipped";
    state.diagnosticRuns[0].optionalSpeaking = {version:1,status:"answered",at:NOW-1,questionId:"favorite-place-present-simple",answer:"My favorite place is home.",observation:"pattern_seen"};
    expect(derive(state).topics).toEqual([]);
  });
});

describe("Progress: optional speaking is an observation, never a mastery event", () => {
  it("labels independent and guided responses separately and never changes recommendations", () => {
    const state = progressFixture(); const before = deriveLearning(state, NOW);
    const s = state.sessions[0];
    s.speakingChallenge = {status:"finished",draft:"",retryUsed:false,attempts:[{text:"I am here.",at:NOW-1,feedback}]};
    expect(speakingObservation(s,NOW)).toMatch(/speaking response \(AI observation\)/);
    s.speakingChallenge.attempts.push({text:"I am here.",at:NOW,feedback}); s.speakingChallenge.retryUsed=true;
    expect(speakingObservation(s,NOW)).toMatch(/after a guided retry/);
    expect(deriveLearning(state,NOW)).toEqual(before);
  });

  it.each([null, { ...feedback, outcome:"unclear" as const }, { ...feedback, confidence:"low" as const }, { ...feedback, assessedSkillIds:["a2-past-simple"] }])("does not call uncertain, missing or unrelated feedback a grammar error", value => {
    const s = progressSession("s", "a1-be-present", NOW);
    s.speakingChallenge = {status:"finished",draft:"",retryUsed:true,attempts:[{text:"I am here.",at:NOW-1,feedback},{text:"I am here.",at:NOW,feedback:value}]};
    expect(speakingObservation(s,NOW)).toMatch(/not verified; this is not a grammar error/);
  });
});
