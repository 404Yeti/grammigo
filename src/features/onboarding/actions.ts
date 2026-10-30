import { listSkills } from "@/curriculum";
import { buildItemPool, createRun, extendRun, recordResponse, type DiagnosticItem, type ItemOutcome } from "@/features/diagnostic/engine";
import { noGoals } from "@/features/learning/goals";
import { deriveLearning } from "@/features/learning/derive";
import { updateState } from "@/lib/storage/store";
import type { LearnerGoals, OnboardingStep, StoredState } from "@/types/session";

function newId(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rnd}`;
}

const set = (state: StoredState, patch: Partial<StoredState["onboarding"]>): StoredState => ({
  ...state,
  onboarding: { ...state.onboarding, ...patch },
});

/** Idempotent: only moves a brand-new learner into the flow. */
export function beginOnboarding(now = Date.now()): void {
  updateState((s) => (s.onboarding.status === "not_started" ? set(s, { status: "in_progress", step: "welcome", startedAt: now }) : s));
}

export function goToStep(step: OnboardingStep): void {
  updateState((s) => set(s, { step }));
}

export function setConcernsDraft(text: string, source: "typed" | "spoken"): void {
  updateState((s) => set(s, { draftText: text, draftSource: source }));
}

/** Stores the interpreted goals and shows them for the learner to confirm. */
export function saveGoalsForConfirmation(goals: LearnerGoals): void {
  updateState((s) => ({ ...set(s, { step: "confirm" }), goals }));
}

export function removeGoalSkill(skillId: string, now = Date.now()): void {
  updateState((s) => {
    if (!s.goals) return s;
    const goalsList = s.goals.goals.map((g) => ({ ...g, skillIds: g.skillIds.filter((id) => id !== skillId) })).filter((g) => g.skillIds.length > 0);
    return { ...s, goals: { ...s.goals, goals: goalsList, skillIds: s.goals.skillIds.filter((id) => id !== skillId), updatedAt: now } };
  });
}

/** Starts the adaptive quiz from the current goals (none = general grammar check). */
export function startQuiz(now = Date.now()): string {
  const id = newId("diag");
  updateState((s) => {
    const goals = s.goals ?? noGoals(now);
    const run = createRun(id, goals.skillIds, now);
    return { ...set({ ...s, goals, diagnosticRuns: [...s.diagnosticRuns, run] }, { status: "in_progress", step: "quiz", runId: id, startedAt: s.onboarding.startedAt ?? now }) };
  });
  return id;
}

/** "Skip the conversation": a general grammar check with no stated goals. */
export function skipConversation(now = Date.now()): string {
  updateState((s) => ({ ...s, goals: noGoals(now), onboarding: { ...s.onboarding, status: "in_progress", startedAt: s.onboarding.startedAt ?? now } }));
  return startQuiz(now);
}

export function answerQuizItem(runId: string, item: DiagnosticItem, outcome: ItemOutcome, now = Date.now()): void {
  updateState((s) => {
    const runs = s.diagnosticRuns.map((r) => (r.id === runId ? recordResponse(r, item, outcome, now) : r));
    const finished = runs.find((r) => r.id === runId)?.finishedAt != null;
    return finished ? set({ ...s, diagnosticRuns: runs }, { step: "profile" }) : { ...s, diagnosticRuns: runs };
  });
}

/** The learner chose a few more questions for a clearer picture. */
export function extendQuiz(runId: string): void {
  updateState((s) => set({ ...s, diagnosticRuns: s.diagnosticRuns.map((r) => (r.id === runId ? extendRun(r) : r)) }, { step: "quiz" }));
}

export function showRecommendation(): void {
  updateState((s) => set(s, { step: "recommendation" }));
}

/** Finishes onboarding and records the recommendation that was shown, so later changes can be explained. */
export function completeOnboarding(now = Date.now()): void {
  updateState((s) => {
    const top = deriveLearning(s, now).top;
    return {
      ...set(s, { status: "completed", completedAt: now }),
      lastRecommendation: top ? { skillId: top.skillId, kind: top.kind, at: now } : s.lastRecommendation,
    };
  });
}

/** "Skip for now": leave without a check; Home keeps offering it. */
export function skipOnboarding(): void {
  updateState((s) => set(s, { status: "skipped" }));
}

/** Update goals and/or retake the check later. Earlier runs stay as history. */
export function restartOnboarding(startAt: "concerns" | "quiz" = "concerns", now = Date.now()): void {
  updateState((s) => set(s, { status: "in_progress", step: startAt === "quiz" ? "quiz" : "concerns", startedAt: now, completedAt: null, runId: null }));
}

export const diagnosticPool = () => buildItemPool(listSkills());
