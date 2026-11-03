import "@/tests/mocks";
import { beforeEach, expect, it } from "vitest";
import { playQuestions, resetApp, lesson } from "@/tests/helpers";
import { getSnapshot } from "@/lib/storage/store";
import { lessonDebrief, debriefText, savedDebrief } from "./debrief";
import { positiveVariant, POSITIVE_RESPONSES } from "./positive";
import { setStorageScope } from "@/lib/scope/storage-scope";

beforeEach(() => { setStorageScope(""); resetApp(); });
it("rotates all three phrases without immediate repetition, retaining the same event", () => {
  const variants = Array.from({ length: 9 }, (_, i) => positiveVariant(`rotation-${i}`));
  expect(new Set(variants).size).toBe(3);
  variants.slice(1).forEach((v, i) => expect(v).not.toBe(variants[i]));
  expect(positiveVariant("rotation-8")).toBe(variants[8]);
  expect(POSITIVE_RESPONSES).toHaveLength(3);
});
it("grounds strengths and one review tip in saved results, leaving writing unverified", () => {
  const id = playQuestions(8, { stumbleOnQ2: true });
  const session = getSnapshot().sessions.find(s => s.id === id)!;
  session.records[7] = { ...session.records[7], resolution: "needs_review", classification: null };
  const result = lessonDebrief(session);
  const text = debriefText(lesson.id, result)!;
  expect(result).toMatchObject({ independent: 6, assisted: 1, unverified: true, tipQuestion: "q2", speaking: "none" });
  expect(text).toContain(lesson.grammarFocus);
  expect(text).toContain("6 exercises correctly on your own");
  expect(text).toContain("Unchecked responses still need review");
  expect(text).not.toMatch(/master|CEFR|B2|fluent/i);
  expect(text.split(/\s+/).length).toBeLessThanOrEqual(85);
});
it("reuses a validated saved debrief and recovers from corrupt storage", () => {
  const id = playQuestions(8);
  const session = getSnapshot().sessions.find(s => s.id === id)!;
  const saved = savedDebrief(session);
  expect(savedDebrief({ ...session, records: [] })).toEqual(saved);
  localStorage.setItem(`grammigo:debrief:v1:${id}`, '{bad');
  expect(savedDebrief(session)).toEqual(saved);
});
it("uses only reliable speaking feedback and makes no claims for skipped or uncertain speech", () => {
  const id = playQuestions(8);
  const session = getSnapshot().sessions.find(s => s.id === id)!;
  const feedback = { outcome: "meets_goal" as const, confidence: "low" as const, errors: [], suggestedCorrection: null, explanation: "Invented mastery claim", example: null, assessedSkillIds: [] };
  session.speakingChallenge = { status: "finished", draft: "", retryUsed: false, attempts: [{ text: "private transcript", at: 1, feedback }] };
  expect(lessonDebrief(session).speaking).toBe("unverified");
  session.speakingChallenge.attempts[0].feedback = { ...feedback, confidence: "high" };
  expect(lessonDebrief(session).speaking).toBe("met");
  expect(debriefText(lesson.id, lessonDebrief(session))).not.toMatch(/private|Invented/);
});

it("keeps all 13 lesson summaries short, with authored topic and valid review references", async () => {
  const { listLessons } = await import("@/data/lessons");
  const lessons = listLessons();
  expect(lessons).toHaveLength(13);
  for (const item of lessons) {
    const text = debriefText(item.id, { independent: 6, assisted: 2, unverified: true, tipQuestion: item.questions[0].id, speaking: "met" })!;
    expect(text).toContain(item.grammarFocus);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(85);
    expect(text.length).toBeLessThan(700);
  }
});
