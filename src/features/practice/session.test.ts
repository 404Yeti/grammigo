import { describe, expect, it } from "vitest";
import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import {
  advance,
  canRetry,
  classify,
  createSession,
  currentRecord,
  deriveLessonState,
  retry,
  setDraft,
  submitAnswer,
  revealHint,
} from "./session";
import { summarizeSession } from "./summary";
import type { Session } from "@/types/session";

const T0 = 1_000_000;

function fresh(): Session {
  return createSession(lesson, "s1", T0);
}

function answer(session: Session, draft: string, now = T0 + 1000) {
  return submitAnswer(setDraft(session, draft, now), lesson, now);
}

describe("lesson initialization", () => {
  it("starts on question 1, awaiting an answer, with a record per question", () => {
    const s = fresh();
    expect(s.currentIndex).toBe(0);
    expect(s.records).toHaveLength(8);
    expect(s.status).toBe("in_progress");
    expect(deriveLessonState(s)).toBe("awaiting_answer");
    expect(deriveLessonState(null)).toBe("not_started");
  });
});

describe("answering", () => {
  it("classifies a correct first attempt as correct_first_try", () => {
    const { session, outcome } = answer(fresh(), "b");
    expect(outcome.kind).toBe("submitted");
    expect(currentRecord(session).classification).toBe("correct_first_try");
    expect(currentRecord(session).resolution).toBe("correct");
    expect(deriveLessonState(session)).toBe("showing_feedback");
  });

  it("keeps a wrong answer open and allows a retry", () => {
    const { session } = answer(fresh(), "a");
    expect(currentRecord(session).resolution).toBe("open");
    expect(currentRecord(session).classification).toBeNull();
    expect(canRetry(session)).toBe(true);
    const retried = retry(session, lesson, T0 + 2000);
    expect(retried.phase).toBe("answering");
    expect(retried.draft).toBe(""); // multiple choice selection is cleared
  });

  it("classifies correct after a retry (no hint) as correct_after_retry", () => {
    let { session } = answer(fresh(), "a");
    session = retry(session, lesson, T0 + 2000);
    ({ session } = answer(session, "b", T0 + 3000));
    expect(currentRecord(session).classification).toBe("correct_after_retry");
  });

  it("classifies correct after a hint (even with a retry) as correct_after_hint", () => {
    let { session } = answer(fresh(), "a");
    session = revealHint(session, lesson, T0 + 2000);
    expect(session.phase).toBe("answering");
    ({ session } = answer(session, "b", T0 + 3000));
    expect(currentRecord(session).classification).toBe("correct_after_hint");
    expect(currentRecord(session).hintsUsed).toBe(1);
  });

  it("counts a hint taken before the first submission as correct_after_hint", () => {
    let session = revealHint(fresh(), lesson, T0 + 500);
    ({ session } = answer(session, "b"));
    expect(currentRecord(session).classification).toBe("correct_after_hint");
  });

  it("reveals hints one at a time and stops at the last one", () => {
    let s = fresh();
    s = revealHint(s, lesson, T0);
    s = revealHint(s, lesson, T0);
    s = revealHint(s, lesson, T0);
    expect(currentRecord(s).hintsUsed).toBe(lesson.questions[0].hints.length);
  });

  it("marks the question incorrect once attempts run out", () => {
    let { session } = answer(fresh(), "a");
    session = retry(session, lesson, T0 + 2000);
    ({ session } = answer(session, "c", T0 + 3000));
    const record = currentRecord(session);
    expect(record.resolution).toBe("exhausted");
    expect(record.classification).toBe("incorrect");
    expect(canRetry(session)).toBe(false);
  });

  it("ignores duplicate submissions while feedback is showing", () => {
    const first = answer(fresh(), "b").session;
    const second = submitAnswer(first, lesson, T0 + 5000);
    expect(second.outcome.kind).toBe("ignored");
    expect(currentRecord(second.session).attempts).toHaveLength(1);
  });

  it("does not create an attempt for an empty answer", () => {
    const { session, outcome } = submitAnswer(fresh(), lesson, T0);
    expect(outcome.kind).toBe("invalid");
    expect(currentRecord(session).attempts).toHaveLength(0);
  });

  it("does not spend an attempt re-submitting the same wrong answer", () => {
    // q2 is a text question
    let s = advance(answer(fresh(), "b").session, T0 + 2000);
    ({ session: s } = answer(s, "watch", T0 + 3000));
    s = retry(s, lesson, T0 + 3500);
    const again = submitAnswer(s, lesson, T0 + 4000);
    expect(again.outcome.kind).toBe("unchanged");
    expect(currentRecord(again.session).attempts).toHaveLength(1);
  });

  it("does not advance before an answer is submitted", () => {
    const s = fresh();
    expect(advance(s, T0 + 1)).toBe(s);
  });

  it("marks unverifiable writing as needs_review without a classification", () => {
    let s = fresh();
    for (let i = 0; i < 7; i++) {
      s = { ...s, currentIndex: i, phase: "feedback" };
    }
    s = { ...s, currentIndex: 7, phase: "answering" };
    ({ session: s } = answer(s, "My cat is very small. The weather looks nice today."));
    expect(currentRecord(s).resolution).toBe("needs_review");
    expect(currentRecord(s).classification).toBeNull();
  });
});

describe("classify()", () => {
  it("covers all four classifications", () => {
    expect(classify({ attempts: [{} as never], hintsUsed: 0 }, true)).toBe("correct_first_try");
    expect(classify({ attempts: [{} as never, {} as never], hintsUsed: 0 }, true)).toBe("correct_after_retry");
    expect(classify({ attempts: [{} as never], hintsUsed: 1 }, true)).toBe("correct_after_hint");
    expect(classify({ attempts: [{} as never], hintsUsed: 0 }, false)).toBe("incorrect");
  });
});

describe("completion", () => {
  const correct = ["b", "watched", "a", "I saw that film yesterday", "They have lived here since 2018", "left", "I have been learning English since 2020", "I have read two books this week. I watched a film yesterday."];

  function playAll(): Session {
    let s = fresh();
    correct.forEach((c, i) => {
      ({ session: s } = answer(s, c, T0 + (i + 1) * 20_000));
      s = advance(s, T0 + (i + 1) * 20_000 + 1000);
    });
    return s;
  }

  it("progresses through all eight questions and completes", () => {
    const s = playAll();
    expect(s.status).toBe("completed");
    expect(s.completedAt).not.toBeNull();
    expect(deriveLessonState(s)).toBe("completed");
  });

  it("summarizes first-try, assisted and incorrect counts correctly", () => {
    let s = fresh();
    // q1 first try
    ({ session: s } = answer(s, "b"));
    s = advance(s, T0 + 2000);
    // q2 wrong then correct => after retry
    ({ session: s } = answer(s, "watch", T0 + 3000));
    s = retry(s, lesson, T0 + 3100);
    ({ session: s } = answer(s, "watched", T0 + 4000));
    s = advance(s, T0 + 4500);
    // q3 hint then correct => after hint
    s = revealHint(s, lesson, T0 + 5000);
    ({ session: s } = answer(s, "a", T0 + 6000));
    s = advance(s, T0 + 6500);
    const summary = summarizeSession(s);
    expect(summary.completed).toBe(3);
    expect(summary.correctFirstTry).toBe(1);
    expect(summary.correctAfterRetry).toBe(1);
    expect(summary.correctAfterHint).toBe(1);
    expect(summary.independent).toBe(1);
    expect(summary.assisted).toBe(2);
    expect(summary.hintsUsed).toBe(1);
    expect(summary.retries).toBe(1);
  });

  it("caps idle gaps so leaving the app does not inflate practice time", () => {
    let s = fresh();
    s = setDraft(s, "b", T0 + 10 * 60 * 60 * 1000); // ten hours later
    expect(s.activeMs).toBe(2 * 60 * 1000);
  });
});
