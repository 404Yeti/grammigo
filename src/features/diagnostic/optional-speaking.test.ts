import { afterEach, expect, it } from "vitest";
import { createRun, diagnosticEvents, assessInconclusive } from "./engine";
import { observeFavoritePlace } from "./speaking-schema";
import { emptyState, parseStoredState } from "@/lib/storage/schema";
import { mergeLessons } from "@/features/sync/merge";
import { getSnapshot, resetStoreCache, updateState } from "@/lib/storage/store";
import { localStorageAdapter } from "@/lib/storage/local-storage-adapter";
import { setPersistenceAdapter } from "@/lib/storage/store";
import { scopedKey, setStorageScope } from "@/lib/scope/storage-scope";
import { saveOptionalSpeaking } from "@/features/onboarding/actions";

const sample = { version: 1, status: "answered", at: 20, questionId: "favorite-place-present-simple", answer: "My favorite place is the park.", observation: "pattern_seen" } as const;
const completed = () => ({ ...createRun("optional-run", [], 1), finishedAt: 10 });
afterEach(() => { setStorageScope(""); localStorage.clear(); setPersistenceAdapter(localStorageAdapter); resetStoreCache(); });

it("keeps optional observations out of diagnostic evidence and the inconclusive calculation", () => {
  const run = completed();
  const withSample = { ...run, optionalSpeaking: sample };
  expect(diagnosticEvents(withSample)).toEqual(diagnosticEvents(run));
  expect(assessInconclusive(withSample)).toEqual(assessInconclusive(run));
  expect(observeFavoritePlace("My favorite place are the park.").observation).toBe("needs_work");
  expect(observeFavoritePlace("Paris is beautiful.").observation).toBe("unverified");
});
it("round-trips versioned confirmed text and strips corrupt optional data without losing closed evidence", () => {
  const state = { ...emptyState(), diagnosticRuns: [{ ...completed(), optionalSpeaking: sample }] };
  expect(parseStoredState(JSON.stringify(state))?.diagnosticRuns[0].optionalSpeaking).toEqual(sample);
  for (const invalid of [{ ...sample, version: 9 }, { ...sample, answer: "x".repeat(501) }, { ...sample, audio: "private payload" }, { version: 1, status: "skipped", at: 1, answer: "unconfirmed" }]) {
    const parsed = parseStoredState(JSON.stringify({ ...state, diagnosticRuns: [{ ...completed(), optionalSpeaking: invalid }] }))!;
    expect(parsed.diagnosticRuns).toHaveLength(1);
    expect(parsed.diagnosticRuns[0].optionalSpeaking).toBeUndefined();
    expect(parsed.diagnosticRuns[0].finishedAt).toBe(10);
  }
});
it("merges a later optional sample without losing it to an older completed run", () => {
  const before = { ...emptyState(), diagnosticRuns: [completed()] };
  const after = { ...emptyState(), diagnosticRuns: [{ ...completed(), optionalSpeaking: sample }] };
  expect(mergeLessons(before, after).diagnosticRuns[0].optionalSpeaking).toEqual(sample);
  expect(mergeLessons(after, before)).toEqual(mergeLessons(before, after));
  expect(mergeLessons(after, after)).toEqual(after);
});
it("saves only to the current scope and refuses uncompleted runs", () => {
  setPersistenceAdapter(localStorageAdapter);
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  setStorageScope(a);
  updateState(() => ({ ...emptyState(), diagnosticRuns: [completed()] }));
  saveOptionalSpeaking("optional-run", sample);
  expect(getSnapshot().diagnosticRuns[0].optionalSpeaking).toEqual(sample);
  const savedA = localStorage.getItem(scopedKey("grammigo:v2", a));
  setStorageScope(b);
  updateState(() => ({ ...emptyState(), diagnosticRuns: [createRun("optional-run", [], 1)] }));
  saveOptionalSpeaking("optional-run", sample);
  expect(getSnapshot().diagnosticRuns[0].optionalSpeaking).toBeUndefined();
  updateState(() => ({ ...emptyState(), diagnosticRuns: [completed()] }));
  saveOptionalSpeaking("optional-run", { version: 1, status: "skipped", at: 30 });
  expect(getSnapshot().diagnosticRuns[0].optionalSpeaking?.status).toBe("skipped");
  expect(localStorage.getItem(scopedKey("grammigo:v2", a))).toBe(savedA);
  expect(localStorage.getItem("grammigo:v2")).toBeNull();
});
