import { updateGuided } from "@/features/guided/store/store";
import { adoptGuided } from "@/features/sync/merge-guided";
import { adoptLessons } from "@/features/sync/merge";
import { getStorageScope } from "@/lib/scope/storage-scope";
import { peekStoredState } from "@/lib/storage/peek";
import { updateState } from "@/lib/storage/store";
import { peekGuidedState } from "@/features/sync/guided-doc";
import type { Incoming } from "./protocol";

/**
 * What adding the incoming progress would do to THIS device's guest progress, and the act of adding it. The preview is computed from copies and
 * writes nothing. The merge is the same lossless union used everywhere (a session or run the guest already has is kept; finished beats unfinished).
 * Only the GUEST's folder is ever written: the signed-in learner's own folder is never a destination for progress that came from outside.
 */
export type TransferPreview = { newLessonsCompleted: number; newLessonsInProgress: number; newQuickChecks: number; newGuidedSessions: number; alreadyThere: number; nothingNew: boolean };

export function previewTransfer(incoming: Incoming): TransferPreview {
  const mineL = peekStoredState("");
  const mineG = peekGuidedState("");
  const lessonIds = new Set((mineL?.sessions ?? []).map((s) => s.id));
  const runIds = new Set((mineL?.diagnosticRuns ?? []).map((r) => r.id));
  const guidedIds = new Set((mineG?.sessions ?? []).map((s) => s.id));
  const newSessions = incoming.lessons.sessions.filter((s) => !lessonIds.has(s.id));
  const finishedRuns = incoming.lessons.diagnosticRuns.filter((r) => r.finishedAt !== null);
  const newRuns = finishedRuns.filter((r) => !runIds.has(r.id));
  const newGuided = incoming.guided.sessions.filter((s) => !guidedIds.has(s.id));
  const total = incoming.lessons.sessions.length + finishedRuns.length + incoming.guided.sessions.length;
  const fresh = newSessions.length + newRuns.length + newGuided.length;
  return {
    newLessonsCompleted: newSessions.filter((s) => s.status === "completed").length,
    newLessonsInProgress: newSessions.filter((s) => s.status === "in_progress").length,
    newQuickChecks: newRuns.length,
    newGuidedSessions: newGuided.length,
    alreadyThere: Math.max(0, total - fresh),
    nothingNew: fresh === 0,
  };
}

export class NotGuestError extends Error {
  constructor() {
    super("progress from another address is only ever added to the guest's own folder");
  }
}

/** Adds the incoming progress to the guest folder. Refuses (and writes nothing) while an account's folder is the active one. */
export function applyTransfer(incoming: Incoming): void {
  if (getStorageScope() !== "") throw new NotGuestError();
  updateState((cur) => adoptLessons(cur, incoming.lessons));
  updateGuided((cur) => adoptGuided(cur, incoming.guided));
}

export function describePreview(p: TransferPreview): string {
  if (p.nothingNew) return "Nothing new: this device already has all of it.";
  const parts = [
    p.newLessonsCompleted ? `${p.newLessonsCompleted} ${p.newLessonsCompleted === 1 ? "lesson" : "lessons"} finished` : null,
    p.newLessonsInProgress ? `${p.newLessonsInProgress} in progress` : null,
    p.newQuickChecks ? `${p.newQuickChecks} quick ${p.newQuickChecks === 1 ? "check" : "checks"}` : null,
    p.newGuidedSessions ? `${p.newGuidedSessions} Guided Correction ${p.newGuidedSessions === 1 ? "session" : "sessions"}` : null,
  ].filter(Boolean);
  return `New to this device: ${parts.join(", ")}.${p.alreadyThere ? ` ${p.alreadyThere} already here, kept as they are.` : ""}`;
}
