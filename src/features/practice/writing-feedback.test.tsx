import "@/tests/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getLesson } from "@/data/lessons";
import { applyWritingEvaluation, advance, createSession, revealHint, setDraft, submitAnswer } from "./session";
import { attachWritingFeedback, practiceActions, startSession } from "./actions";
import { SessionScreen } from "./SessionScreen";
import { getSnapshot } from "@/lib/storage/store";
import { resetApp } from "@/tests/helpers";
import type { Session } from "@/types/session";

vi.mock("@/features/ai/client", () => ({
  fetchAiStatus: async () => ({ available: false }),
  requestGoals: async () => null,
  requestTranscription: async () => null,
  requestWritingFeedback: async () => null,
}));

const lesson = getLesson("a1-be-present")!;
const CLOSED = ["She is a teacher.", "am", "are", "They are very happy", "My best friend is from Italy", "am", "We are not happy"];
const optionId = (q: number, label: string) => lesson.questions[q].options!.find((o) => o.label === label)!.id;
const WRITING = "I am a student. She is my friend and we are happy.";

/** Plays a1-be-present up to and including the (unverifiable) writing question. */
function playToWriting(s0: Session, hint = false): Session {
  let s = s0;
  CLOSED.forEach((a, i) => {
    const draft = lesson.questions[i].options ? optionId(i, a) : a;
    s = setDraft(s, draft, 10 + i);
    s = submitAnswer(s, lesson, 20 + i).session;
    s = advance(s, 30 + i);
  });
  if (hint) s = revealHint(s, lesson, 90);
  s = setDraft(s, WRITING, 100);
  return submitAnswer(s, lesson, 110).session;
}

const fresh = () => createSession(lesson, "s-w", 1);
const FB = { outcome: "meets_goal" as const, confidence: "high" as const };

describe("applyWritingEvaluation: AI can help the learner but never penalize", () => {
  it("saves the answer as unverified first (no AI, no verdict)", () => {
    const s = playToWriting(fresh());
    const r = s.records[7];
    expect(r.resolution).toBe("needs_review");
    expect(r.classification).toBeNull();
  });

  it("a confident confirmation upgrades it to correct_first_try", () => {
    const s = applyWritingEvaluation(playToWriting(fresh()), lesson, "q8", FB, 200);
    expect(s.records[7].resolution).toBe("correct");
    expect(s.records[7].classification).toBe("correct_first_try");
  });

  it("classifies from the help actually used (hint → correct_after_hint)", () => {
    const s = applyWritingEvaluation(playToWriting(fresh(), true), lesson, "q8", FB, 200);
    expect(s.records[7].classification).toBe("correct_after_hint");
  });

  it("medium confidence also counts; low confidence does nothing", () => {
    const base = playToWriting(fresh());
    expect(applyWritingEvaluation(base, lesson, "q8", { outcome: "meets_goal", confidence: "medium" }, 1).records[7].resolution).toBe("correct");
    expect(applyWritingEvaluation(base, lesson, "q8", { outcome: "meets_goal", confidence: "low" }, 1)).toBe(base);
  });

  it("'needs_work' and 'unclear' never mark the answer incorrect or change it", () => {
    const base = playToWriting(fresh());
    for (const outcome of ["needs_work", "unclear"] as const) {
      const out = applyWritingEvaluation(base, lesson, "q8", { outcome, confidence: "high" }, 1);
      expect(out).toBe(base);
      expect(out.records[7].resolution).toBe("needs_review");
      expect(out.records[7].classification).toBeNull();
    }
  });

  it("never touches closed-ended questions (deterministic grading is final)", () => {
    const base = playToWriting(fresh());
    const wrongFirst = { ...base, records: base.records.map((r, i) => (i === 0 ? { ...r, resolution: "needs_review" as const, classification: null } : r)) };
    expect(applyWritingEvaluation(wrongFirst, lesson, "q1", FB, 1)).toBe(wrongFirst);
  });

  it("is idempotent for already-resolved answers", () => {
    const once = applyWritingEvaluation(playToWriting(fresh()), lesson, "q8", FB, 1);
    expect(applyWritingEvaluation(once, lesson, "q8", FB, 2)).toBe(once);
  });
});

describe("writing feedback in the lesson screen", () => {
  beforeEach(() => resetApp());

  function seedAtWriting() {
    const id = startSession(lesson);
    CLOSED.forEach((a, i) => {
      practiceActions.setDraft(id, lesson.questions[i].options ? optionId(i, a) : a);
      practiceActions.submit(id, lesson);
      practiceActions.advance(id);
    });
    practiceActions.setDraft(id, WRITING);
    practiceActions.submit(id, lesson);
    return id;
  }

  it("shows the AI's explanation even when it upgrades the answer to correct (regression)", async () => {
    const id = seedAtWriting();
    attachWritingFeedback(id, lesson, "q8", { status: "ready", at: 5, ...FB, errors: [], explanation: "Both sentences use am, is and are correctly.", suggestedCorrection: null, example: null });
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByTestId("feedback-panel")).toHaveAttribute("data-kind", "correct-independent");
    expect(screen.getByTestId("ai-feedback")).toHaveTextContent("Both sentences use am, is and are correctly.");
    expect(getSnapshot().sessions[0].records[7].classification).toBe("correct_first_try");
  });

  it("'needs_work' feedback is shown as feedback only; the answer stays unverified, never incorrect", async () => {
    const id = seedAtWriting();
    attachWritingFeedback(id, lesson, "q8", { status: "ready", at: 5, outcome: "needs_work", confidence: "high", errors: [], explanation: "Try using “are” with “we”.", suggestedCorrection: "We are happy.", example: null });
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByTestId("feedback-panel")).toHaveAttribute("data-kind", "needs-review");
    expect(screen.getByTestId("ai-feedback")).toHaveTextContent(/feedback only/);
    expect(screen.getByTestId("ai-feedback")).toHaveTextContent("We are happy.");
    expect(getSnapshot().sessions[0].records[7].resolution).toBe("needs_review");
  });

  it("with no AI the answer is simply saved for review and the lesson can continue", async () => {
    seedAtWriting();
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByTestId("feedback-panel")).toHaveAttribute("data-kind", "needs-review");
    expect(screen.queryByTestId("ai-feedback")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-pending")).not.toBeInTheDocument(); // not "checking…" when AI is off
    expect(screen.getByRole("button", { name: "Finish lesson" })).toBeEnabled();
  });

  it("an 'unavailable' result leaves the answer unverified without blocking", async () => {
    const id = seedAtWriting();
    attachWritingFeedback(id, lesson, "q8", { status: "unavailable", at: 5 });
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByTestId("feedback-panel")).toHaveAttribute("data-kind", "needs-review");
    expect(getSnapshot().sessions[0].records[7].classification).toBeNull();
  });
});
