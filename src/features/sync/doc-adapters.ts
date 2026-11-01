import { parseStoredState } from "@/lib/storage/schema";
import { getSnapshot, subscribe, updateState } from "@/lib/storage/store";
import type { StoredState } from "@/types/session";
import type { DocAdapter } from "./engine";
import { canonical } from "./canonical";
import { adoptLessons } from "./merge";

/** Lesson progress as a syncable document. `io` is the real saved-state store in the app and an in-memory twin in tests. */
export type LessonsIO = { read(): StoredState; update(fn: (s: StoredState) => StoredState): void; subscribe(l: () => void): () => void };

export const lessonsHasProgress = (s: StoredState): boolean =>
  s.sessions.length > 0 || s.diagnosticRuns.length > 0 || s.goals !== null || s.onboarding.status === "in_progress" || s.onboarding.status === "completed";

/** Goes up when a lesson is FINISHED or a quick check completes: the moment worth saving. */
export const lessonsCheckpointMarker = (s: StoredState): number => s.sessions.filter((x) => x.status === "completed").length + s.diagnosticRuns.filter((r) => r.finishedAt !== null).length;

export function lessonsAdapter(io: LessonsIO): DocAdapter {
  return {
    key: "lessons_v2",
    read: () => io.read(),
    parse: (body) => parseStoredState(JSON.stringify(body)),
    adopt: (remote) => {
      // Folding in a copy that adds nothing must change nothing: no write, no notification, no re-render of a lesson someone is answering.
      const cur = io.read();
      if (canonical(adoptLessons(cur, remote as StoredState)) === canonical(cur)) return;
      io.update((c) => adoptLessons(c, remote as StoredState));
    },
    hasProgress: (doc) => lessonsHasProgress(doc as StoredState),
    checkpointMarker: (doc) => lessonsCheckpointMarker(doc as StoredState),
    subscribe: (l) => io.subscribe(l),
  };
}

/** The real thing: whichever learner's saved progress the browser is currently pointed at (see lib/scope/storage-scope). */
export const storeLessonsAdapter = (): DocAdapter => lessonsAdapter({ read: getSnapshot, update: (fn) => void updateState(fn), subscribe });
