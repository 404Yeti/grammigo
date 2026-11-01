import "@/tests/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { dispatchGuided, startGuidedSession } from "@/features/guided/store/actions";
import { countOutcomes } from "@/features/guided/store/outcome-counts";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { getStorageScope, scopedKey, setStorageScope } from "@/lib/scope/storage-scope";
import { STORAGE_KEY } from "@/lib/storage/schema";
import { getSnapshot } from "@/lib/storage/store";
import { lesson, playQuestions, resetApp } from "@/tests/helpers";
import { Dashboard } from "./Dashboard";

/**
 * Student A signs out and Student B signs in on the same browser, with guest progress already there. The rules under test:
 *   - nobody sees anybody else's progress, on the dashboard or anywhere else;
 *   - the guest's progress is never deleted, overwritten or imported;
 *   - going back to a learner brings back exactly their own progress.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GUIDED = "grammigo:guided:v1";
const raw = (key: string) => window.localStorage.getItem(key);
const sessions = () => getSnapshot().sessions;

function guidedActivity(id: string) {
  const NOW = 1_800_000_000_000;
  startGuidedSession({ now: NOW, id });
  dispatchGuided(id, { type: "EDIT", draft: "I have watched a film yesterday evening." }, { now: NOW + 1, aiAvailable: true });
  dispatchGuided(id, { type: "SUBMIT" }, { now: NOW + 2, aiAvailable: true });
}

beforeEach(() => {
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
  document.cookie = "gm-scope=; Max-Age=0; Path=/";
});

describe("saved progress is separated per learner on one browser", () => {
  it("guest, then A, then B, then A again: each sees only their own, and the guest's progress is never touched", () => {
    // the guest practises first
    playQuestions(3);
    guidedActivity("guest-g");
    const guestLessons = raw(STORAGE_KEY)!;
    const guestGuided = raw(GUIDED)!;
    const guestSessionIds = sessions().map((s) => s.id);
    expect(guestSessionIds).toHaveLength(1);

    // Student A signs in on this browser
    setStorageScope(A);
    expect(sessions()).toEqual([]); // A does not see the guest's lesson
    expect(getGuidedSnapshot().sessions).toEqual([]);
    playQuestions(5);
    guidedActivity("a-g");
    const aSession = sessions().map((s) => s.id);
    expect(aSession).toHaveLength(1);
    expect(aSession[0]).not.toBe(guestSessionIds[0]);
    const aLessons = raw(scopedKey(STORAGE_KEY, A))!;
    const aGuided = raw(scopedKey(GUIDED, A))!;

    // A signs out: back to the guest, who sees exactly their own progress, unchanged
    setStorageScope("");
    expect(sessions().map((s) => s.id)).toEqual(guestSessionIds);
    expect(raw(STORAGE_KEY)).toBe(guestLessons);
    expect(raw(GUIDED)).toBe(guestGuided);

    // Student B signs in: sees neither A's nor the guest's
    setStorageScope(B);
    expect(sessions()).toEqual([]);
    expect(getGuidedSnapshot().sessions).toEqual([]);
    expect(countOutcomes(getGuidedSnapshot())).toEqual({ first_try: 0, self_corrected: 0, hint_assisted: 0, shown: 0, unverified: 0 });
    playQuestions(2);
    const bSession = sessions().map((s) => s.id);
    expect(bSession).toHaveLength(1);

    // nothing about A or the guest moved while B was here
    expect(raw(scopedKey(STORAGE_KEY, A))).toBe(aLessons);
    expect(raw(scopedKey(GUIDED, A))).toBe(aGuided);
    expect(raw(STORAGE_KEY)).toBe(guestLessons);
    expect(raw(GUIDED)).toBe(guestGuided);

    // A signs back in: A's progress is exactly as A left it
    setStorageScope(A);
    expect(sessions().map((s) => s.id)).toEqual(aSession);
    expect(raw(scopedKey(STORAGE_KEY, A))).toBe(aLessons);
    expect(getStorageScope()).toBe(A);
  });

  it("an account's progress never falls back to the guest's or the old v1 key", () => {
    window.localStorage.setItem("grammigo:v1", JSON.stringify({ version: 1, sessions: [] }));
    playQuestions(2);
    setStorageScope(A);
    expect(sessions()).toEqual([]);
    expect(raw(scopedKey(STORAGE_KEY, A))).toBeNull(); // nothing was copied in
  });

  it("a screen that is already open re-reads at once when the browser switches learner (no stale progress left on screen)", async () => {
    const { act } = await import("@testing-library/react");
    const { usePracticeState } = await import("@/features/practice/use-practice-state");
    function Count() {
      const state = usePracticeState();
      return <p data-testid="count">{state ? state.sessions.length : "…"}</p>;
    }
    setStorageScope(A);
    playQuestions(4);
    render(<Count />);
    expect(await screen.findByTestId("count")).toHaveTextContent("1");
    act(() => setStorageScope(B));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    act(() => setStorageScope(A));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});

describe("the dashboard only ever shows the signed-in learner's own progress", () => {
  const show = (userId: string, name: string) => render(<Dashboard userId={userId} displayName={name} practising={[]} welcome={false} />);

  it("B signs in after A on the same browser: A's lesson and name never appear, not even for the first render", async () => {
    setStorageScope(A);
    playQuestions(3); // A has a lesson in progress
    setStorageScope(""); // A signs out…
    setStorageScope(A); // …(the browser was still pointed at A when B's page loaded)
    const aLessons = raw(scopedKey(STORAGE_KEY, A));

    const { container } = show(B, "Student Bee");
    // the very first render, before anything has been re-pointed
    expect(container.textContent).not.toContain(lesson.title);
    expect(container.textContent).not.toMatch(/Continue where you left off|YOUR NEXT STEP|Skills so far/);

    // then the browser is pointed at B, and B sees a brand-new account
    expect(await screen.findByTestId("dashboard-new")).toBeInTheDocument();
    expect(getStorageScope()).toBe(B);
    expect(document.cookie).toContain(`gm-scope=${B}`);
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent("Hi, Student Bee");
    expect(document.body.textContent).not.toContain(lesson.title);
    expect(raw(scopedKey(STORAGE_KEY, A))).toBe(aLessons); // A's progress untouched
    expect(sessions()).toEqual([]);
  });

  it("a signed-in learner whose browser was still on the GUEST's progress does not see it, and it is not imported", async () => {
    playQuestions(4); // guest progress
    const guestLessons = raw(STORAGE_KEY)!;
    const { container } = show(A, "Ana");
    expect(container.textContent).not.toContain(lesson.title);
    expect(await screen.findByTestId("dashboard-new")).toBeInTheDocument();
    expect(getStorageScope()).toBe(A);
    expect(raw(STORAGE_KEY)).toBe(guestLessons); // the guest's progress is exactly as it was: not deleted, not overwritten
    expect(sessions()).toEqual([]); // and it was not imported into Ana's progress
    expect(raw(scopedKey(STORAGE_KEY, A))).toBeNull();
  });

  it("each learner's own progress shows for them, and only for them", async () => {
    setStorageScope(A);
    playQuestions(3);
    setStorageScope(B);
    playQuestions(5);
    setStorageScope(A);
    const { unmount } = show(A, "Ana");
    expect(await screen.findByTestId("dashboard-continue")).toHaveTextContent(/Question 4 of 8/);
    unmount();
    show(B, "Bee");
    await waitFor(() => expect(screen.getByTestId("dashboard-continue")).toHaveTextContent(/Question 6 of 8/));
    expect(getStorageScope()).toBe(B);
  });
});
