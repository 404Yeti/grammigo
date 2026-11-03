import { describe, expect, it } from "vitest";
import { listSkills } from "@/curriculum";
import { speakingChallenge, CHALLENGE_ID } from "./content";
import { newChallenge } from "./schema";
import { speechText } from "@/features/voice/content";
import { createSession } from "@/features/practice/session";
import { getLesson } from "@/data/lessons";
import { emptyState, parseStoredState } from "@/lib/storage/schema";
import { mergeLessons } from "@/features/sync/merge";

describe("final speaking content and compatible persistence", () => {
  it("selects an authored target-grammar task and TTS for all 13 lessons", () => {
    expect(listSkills()).toHaveLength(13);
    for (const skill of listSkills()) {
      const task = speakingChallenge(skill.id)!;
      expect(task).not.toBeNull();
      expect(task.id).toBe(CHALLENGE_ID);
      expect(task.strategy).toBe("ai-writing");
      expect(task.prompt).not.toMatch(/\bwrite\b/i);
      expect(task.writingCriteria).toContain(skill.cefr);
      expect(task.writingCriteria).toContain("learner-confirmed transcription");
      expect(speechText({ lessonId: skill.id, questionId: CHALLENGE_ID, kind: "instruction" })).toBe(task.prompt);
    }
    expect(speakingChallenge("unknown")).toBeNull();
  });
  const lesson = getLesson("a1-be-present")!;
  const original = createSession(lesson, "session", 1);
  it("preserves legacy and completed sessions without a new requirement", () => {
    for (const status of ["in_progress", "completed"] as const) {
      const session = { ...original, status };
      const saved = { ...emptyState(), sessions: [session] };
      expect(parseStoredState(JSON.stringify(saved))?.sessions).toEqual([session]);
    }
  });
  it("round-trips a draft, one retry, submitted text and unverified feedback through storage and sync", () => {
    const challenge = { ...newChallenge(), draft: "I am happy.", retryUsed: true, attempts: [{ text: "I is happy.", at: 2, feedback: null }] };
    const saved = { ...emptyState(), sessions: [{ ...original, updatedAt: 3, speakingChallenge: challenge }], activeSessionId: original.id };
    const parsed = parseStoredState(JSON.stringify(saved))!;
    expect(parsed.sessions[0].speakingChallenge).toEqual(challenge);
    const merged = mergeLessons({ ...emptyState(), sessions: [original] }, parsed);
    expect(merged.sessions[0].speakingChallenge).toEqual(challenge);
    expect(merged.sessions[0].records).toEqual(original.records);
  });
  it("drops a corrupt optional challenge without losing valid lesson work", () => {
    const saved = { ...emptyState(), sessions: [{ ...original, speakingChallenge: { draft: 8 } }] };
    expect(parseStoredState(JSON.stringify(saved))?.sessions).toEqual([original]);
  });
});
