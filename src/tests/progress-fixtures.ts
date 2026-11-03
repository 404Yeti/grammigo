import { getLesson } from "@/data/lessons";
import { createRun } from "@/features/diagnostic/engine";
import { createSession } from "@/features/practice/session";
import { emptyState } from "@/lib/storage/schema";
import type { Classification, Session } from "@/types/session";

export const PROGRESS_NOW = Date.parse("2026-11-03T12:00:00Z");

/** Authored question ids and ordinary persisted shapes, shared by unit/DB/browser checks. */
export function progressSession(id: string, skillId: string, at: number, outcome: Classification | null = "correct_first_try"): Session {
  const session = createSession(getLesson(skillId)!, id, at - 60_000);
  return { ...session, status: "completed", completedAt: at, updatedAt: at, records: session.records.map(record => ({
    ...record, classification: outcome, resolution: outcome === null ? "needs_review" : outcome === "incorrect" ? "exhausted" : "correct",
    finalAnswer: "A saved answer", attempts: [{ answer: "A saved answer", at, hintsUsedBefore: 0, verdict: outcome === null ? "needs_review" : outcome === "incorrect" ? "incorrect" : "correct" }],
  })) };
}

export function progressFixture() {
  const state = emptyState();
  state.onboarding.status = "skipped";
  state.sessions = [
    progressSession("strong-one", "a1-be-present", PROGRESS_NOW - 3_600_000),
    progressSession("strong-two", "a1-be-present", PROGRESS_NOW - 1_800_000),
    progressSession("review", "a2-past-simple", PROGRESS_NOW - 900_000, "incorrect"),
    progressSession("unchecked", "a1-articles", PROGRESS_NOW - 600_000, null),
  ];
  const run = createRun("quick-check", [], PROGRESS_NOW - 500_000);
  run.responses = [{ itemId: "a2-comparatives/q1", skillId: "a2-comparatives", outcome: "correct", at: PROGRESS_NOW - 400_000 }];
  run.finishedAt = PROGRESS_NOW - 400_000;
  state.diagnosticRuns = [run];
  state.goals = { text: "I want to practise the first conditional", source: "typed", goals: [], skillIds: ["b1-first-conditional"], extractedBy: "local", updatedAt: PROGRESS_NOW };
  return state;
}
