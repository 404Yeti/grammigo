import { presentPerfectVsPastSimple as lesson } from "@/data/lessons/present-perfect-vs-past-simple";
import { practiceActions, startSession } from "@/features/practice/actions";
import { updateState, resetStoreCache } from "@/lib/storage/store";
import { vi } from "vitest";

export { lesson };

export const CORRECT_ANSWERS = [
  "b",
  "watched",
  "a",
  "I saw that film yesterday",
  "They have lived here since 2018",
  "left",
  "I have been learning English since 2020",
  "I have read two books this week. I watched a film yesterday.",
];

export function resetApp(): void {
  window.localStorage.clear();
  resetStoreCache();
}

/** Plays `count` questions through the real actions. Optionally makes q2 go wrong then right (after retry). */
export function playQuestions(count: number, options: { stumbleOnQ2?: boolean } = {}): string {
  const id = startSession(lesson);
  for (let i = 0; i < count; i++) {
    if (i === 1 && options.stumbleOnQ2) {
      practiceActions.setDraft(id, "watch");
      practiceActions.submit(id, lesson);
      practiceActions.retry(id, lesson);
    }
    practiceActions.setDraft(id, CORRECT_ANSWERS[i]);
    practiceActions.submit(id, lesson);
    practiceActions.advance(id);
  }
  return id;
}

export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

export function touchState(): void {
  updateState((s) => s);
}
