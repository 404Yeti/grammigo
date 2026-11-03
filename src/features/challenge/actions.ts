import type { SpeakingChallenge } from "./schema";
import { newChallenge } from "./schema";
import { updateState } from "@/lib/storage/store";
import { getScopeRevision } from "@/lib/scope/storage-scope";
import type { WritingFeedback } from "@/features/ai/schemas";

/** Scope revision also rejects callbacks after switching away and back to the same account. */
export function updateChallenge(sessionId: string, revision: number, change: (c: SpeakingChallenge) => SpeakingChallenge): void {
  if (getScopeRevision() !== revision) return;
  updateState(state => ({ ...state, sessions: state.sessions.map(s => s.id === sessionId && s.status === "in_progress"
    ? { ...s, updatedAt: Date.now(), speakingChallenge: change(s.speakingChallenge ?? newChallenge()) } : s) }));
}

export function saveChallengeFeedback(sessionId: string, revision: number, index: number, text: string, feedback: WritingFeedback | null): void {
  updateChallenge(sessionId, revision, c => c.status !== "active" ? c : ({ ...c, attempts: c.attempts.map((a, i) => i === index && a.text === text ? { ...a, feedback } : a) }));
}
