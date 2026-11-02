import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getLesson } from "@/data/lessons";
import { deriveLearning } from "@/features/learning/derive";
import { createSession } from "@/features/practice/session";
import { emptyState } from "@/lib/storage/schema";
import type { Classification, Session, StoredState } from "@/types/session";
import { dispatchGuided, startGuidedSession } from "./store/actions";
import { guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "./store/store";

const ROOT = join(process.cwd(), "src");
const GUIDED_DIRS = ["features/guided", "curriculum/guided"].map((d) => join(ROOT, d));
const GUIDED_FILES = [join(ROOT, "types/guided.ts")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const importsOf = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
const isGuidedPath = (p: string) => GUIDED_DIRS.some((d) => p.startsWith(d)) || GUIDED_FILES.includes(p);

/**
 * The ONLY existing files allowed to import guided code, and exactly what each may import. They are
 * entry points (a route, an API route, two screens that show an optional card); none of them is a
 * mastery, profile, recommendation, lesson-progress or storage module, and none passes data across.
 */
const ENTRY_POINTS: Record<string, string[]> = {
  "app/api/guided/access/route.ts": ["@/features/guided/visibility"],
  "app/practice/[lessonId]/guided/page.tsx": ["@/curriculum/guided", "@/features/guided/visibility", "@/features/guided/ui/GuidedScreen"],
  "app/api/ai/guided-check/route.ts": ["@/features/guided/ai/check"],
  "features/lessons/IntroScreen.tsx": ["@/features/guided/ui/GuidedEntryCard"],
  "features/practice/ReviewScreen.tsx": ["@/features/guided/ui/GuidedEntryCard"],
  // The learner dashboard shows a counts-only activity card, labelled Beta, provisional and separate from lesson progress.
  "features/accounts/Dashboard.tsx": ["@/features/guided/ui/GuidedActivityCard"],
  // Syncing Guided Correction activity as its OWN document: validating and saving it, never reading or feeding mastery.
  "features/sync/guided-doc.ts": ["@/features/guided/store/schema", "@/features/guided/store/store", "@/types/guided"],
  "features/sync/sim.ts": ["@/features/guided/store/schema", "@/types/guided"],
  "features/sync/merge-guided.ts": ["@/features/guided/store/schema", "@/types/guided"],
  // Adding the guest's saved Guided Correction activity to an account, on the learner's say-so.
  "features/sync/guest-import.ts": ["@/features/guided/store/store", "@/types/guided"],
  // Removing a deleted account's own saved Guided Correction folder from the device: it names a storage key and reads nothing.
  "features/accounts/local-cleanup.ts": ["@/features/guided/store/schema"],
  // Carrying a guest's saved Guided Correction activity from the old web address to the new one, on the learner's say-so: validate and merge, never score.
  "features/transfer/apply.ts": ["@/features/guided/store/store", "@/features/guided/store/schema"],
  "features/transfer/protocol.ts": ["@/features/guided/store/schema", "@/types/guided"],
};

describe("guided code and learning code cannot see each other", () => {
  const all = sources(ROOT);
  const outside = all.filter((f) => !isGuidedPath(f));
  const inside = all.filter(isGuidedPath);
  const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

  it("no existing module (mastery, profile, recommendations, lessons, storage…) imports anything guided, except the named entry points", () => {
    const offenders = outside.flatMap((f) =>
      importsOf(f)
        .filter((i) => /(^|\/)guided(\/|$)/.test(i) && !(ENTRY_POINTS[rel(f)] ?? []).includes(i))
        .map((i) => `${rel(f)} → ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  it("every entry point still exists and really is one (so the list cannot rot into a loophole)", () => {
    for (const [file, allowed] of Object.entries(ENTRY_POINTS)) {
      const imports = importsOf(join(ROOT, file));
      expect(imports.some((i) => allowed.includes(i)), file).toBe(true);
    }
  });

  it("guided code imports nothing from mastery, the profile, recommendations, lesson progress, diagnostics, onboarding, lesson data or lesson storage", () => {
    const forbidden = [/features\/learning/, /features\/practice/, /features\/diagnostic/, /features\/lessons/, /features\/onboarding/, /features\/mastery/, /features\/profile/, /features\/recommendation/, /lib\/storage/, /types\/session/, /^@\/data/, /^@\/curriculum$/, /^@\/curriculum\/(?!guided)/];
    const offenders = inside.flatMap((f) => importsOf(f).filter((i) => forbidden.some((re) => re.test(i))).map((i) => `${rel(f)} → ${i}`));
    expect(offenders).toEqual([]);
  });

  it("the guided store never names the lesson storage keys", () => {
    for (const f of inside) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/grammigo:v[12]\b/);
    }
  });
});

const NOW = 1_800_000_000_000;

function completedLesson(lessonId: string, outcomes: Classification[], n: number): Session {
  const lesson = getLesson(lessonId)!;
  let s = createSession(lesson, `seed-${lessonId}-${n}`, NOW - 90_000_000 + n * 1000);
  s = { ...s, status: "completed", completedAt: NOW - 80_000_000 + n * 1000, activeMs: 300_000, currentIndex: 7, phase: "feedback" };
  return {
    ...s,
    records: s.records.map((r, i) => ({
      ...r,
      attempts: [{ answer: "x", verdict: outcomes[i % outcomes.length] === "incorrect" ? ("incorrect" as const) : ("correct" as const), at: NOW - 85_000_000 + i, hintsUsedBefore: 0 }],
      classification: outcomes[i % outcomes.length],
      resolution: outcomes[i % outcomes.length] === "incorrect" ? ("exhausted" as const) : ("correct" as const),
      finalAnswer: "x",
    })),
  };
}

const learnerState = (): StoredState => ({
  ...emptyState(),
  sessions: [
    completedLesson("a1-be-present", ["correct_first_try", "correct_first_try", "correct_after_hint", "incorrect"], 1),
    completedLesson("a1-articles", ["incorrect", "incorrect", "correct_after_retry", "incorrect"], 2),
    completedLesson("a2-past-simple", ["correct_first_try", "correct_first_try", "correct_first_try", "correct_after_hint"], 3),
    completedLesson("present-perfect-vs-past-simple", ["correct_first_try", "incorrect", "correct_after_retry", "correct_first_try"], 4),
  ],
  goals: { text: "articles", source: "typed", goals: [{ label: "Articles", skillIds: ["a1-articles"] }], skillIds: ["a1-articles"], extractedBy: "local", updatedAt: NOW },
});

/** Everything the learner sees about mastery, the profile and what to do next, in a comparable form. */
const learningSnapshot = (state: StoredState) => {
  const l = deriveLearning(state, NOW);
  return JSON.stringify({ mastery: [...l.mastery.entries()], profile: l.profile, recommendations: l.recommendations, top: l.top, events: l.events });
};

describe("existing mastery calculations are unchanged by Guided Correction", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setGuidedPersistence(guidedLocalStorage);
    resetGuidedStoreCache();
  });

  it("mastery, profile, recommendations and evidence events are identical before and after any amount of guided activity", () => {
    const state = learnerState();
    const before = learningSnapshot(state);
    expect(before.length).toBeGreaterThan(1000); // a real, non-trivial result, not an empty comparison

    // success, mistakes, hints, Show me, voice failure, AI-confirmed, unverified, transfer, completion
    startGuidedSession({ now: NOW, id: "g1" });
    const send = (e: Parameters<typeof dispatchGuided>[1], t: number, ai = true) => dispatchGuided("g1", e, { now: NOW + t, aiAvailable: ai });
    send({ type: "EDIT", draft: "I have watched a film yesterday evening." }, 1);
    send({ type: "SUBMIT" }, 2);
    send({ type: "REQUEST_HINT" }, 3);
    send({ type: "START_RECORDING" }, 4);
    send({ type: "TRANSCRIPT_FAILED", reason: "permission_denied" }, 5);
    send({ type: "EDIT", draft: "I watched a film with my sister." }, 6);
    send({ type: "SUBMIT" }, 7);
    send({ type: "CONTINUE" }, 8);
    send({ type: "START_TRANSFER" }, 9);
    send({ type: "EDIT", draft: "I have been to Spain." }, 10);
    send({ type: "SUBMIT" }, 11);
    send({ type: "OPINION", result: { status: "ok", opinion: { fit: "fits", confidence: "high", suspected: null } } }, 12);
    send({ type: "CONTINUE" }, 13);
    send({ type: "FINISH" }, 14);
    startGuidedSession({ now: NOW + 20, id: "g2" });
    dispatchGuided("g2", { type: "SHOW_ME" }, { now: NOW + 21 });

    expect(learningSnapshot(state)).toBe(before);
  });

  it("the same holds for a learner with no goals and for a brand-new learner", () => {
    for (const state of [{ ...learnerState(), goals: null }, emptyState()]) {
      const before = learningSnapshot(state);
      startGuidedSession({ now: NOW, id: "gx" });
      dispatchGuided("gx", { type: "SHOW_ME" }, { now: NOW + 1 });
      expect(learningSnapshot(state)).toBe(before);
      window.localStorage.clear();
      resetGuidedStoreCache();
    }
  });

  it("outcome weights are not mastery values: no learning module reads them", () => {
    const learningDir = join(ROOT, "features/learning");
    for (const f of sources(learningDir)) expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(/GUIDED_OUTCOME_VALUES|summarizeOutcomes|outcomeRecords|cycle\/outcome/);
  });
});
