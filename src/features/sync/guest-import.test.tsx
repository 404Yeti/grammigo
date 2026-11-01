import "@/tests/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dispatchGuided, startGuidedSession } from "@/features/guided/store/actions";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { STORAGE_KEY } from "@/lib/storage/schema";
import { getSnapshot } from "@/lib/storage/store";
import { playQuestions, resetApp } from "@/tests/helpers";
import { addedToAnotherAccount, alreadyAddedTo, importGuest, readGuest, summarizeGuest } from "./guest-import";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GUIDED = "grammigo:guided:v1";
const raw = (k: string) => window.localStorage.getItem(k);
const enable = vi.fn();
vi.mock("./hooks", () => ({ useSyncEngine: () => ({ enable, getMetrics: () => ({ calls: 0 }) }), useSyncStatus: () => null }));

function guestActivity() {
  const NOW = 1_800_000_000_000;
  startGuidedSession({ now: NOW, id: "gg" });
  dispatchGuided("gg", { type: "EDIT", draft: "I have watched a film yesterday evening." }, { now: NOW + 1, aiAvailable: true });
}

beforeEach(async () => {
  (await import("./guest-import")).forgetLastAdded();
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
  enable.mockClear();
});

describe("looking at the guest's progress is read-only", () => {
  it("reads copies, writes nothing, and leaves storage byte-identical", () => {
    playQuestions(8);
    guestActivity();
    const before = JSON.stringify({ ...window.localStorage });
    const g = readGuest();
    expect(g?.lessons.sessions).toHaveLength(1);
    expect(g?.guided.sessions).toHaveLength(1);
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
  });

  it("counts what is there, and the fingerprint changes when the guest learns something new", () => {
    expect(summarizeGuest(readGuest())).toMatchObject({ hasProgress: false, fingerprint: "" });
    playQuestions(8);
    const one = summarizeGuest(readGuest());
    expect(one).toMatchObject({ hasProgress: true, lessonsCompleted: 1, lessonsInProgress: 0, guidedSessions: 0 });
    guestActivity();
    const two = summarizeGuest(readGuest());
    expect(two.guidedSessions).toBe(1);
    expect(two.fingerprint).not.toBe(one.fingerprint);
  });

  it("only the GUEST's folder can ever be offered: another account's progress on a shared device is never read for this", () => {
    setStorageScope(A);
    playQuestions(8); // A's own progress
    setStorageScope(B);
    expect(summarizeGuest(readGuest()).hasProgress).toBe(false); // B is offered nothing: there is no guest progress, and A's is not a candidate
    setStorageScope("");
    expect(summarizeGuest(readGuest()).hasProgress).toBe(false);
  });
});

describe("adding the guest's progress to an account", () => {
  it("merges into the account's own progress, keeps what the account already had, and leaves the guest's progress exactly as it was", () => {
    playQuestions(8); // the guest finished a lesson
    guestActivity();
    const guestLessons = raw(STORAGE_KEY)!;
    const guestGuided = raw(GUIDED)!;
    setStorageScope(A);
    playQuestions(3); // the account already had a lesson in progress
    const own = getSnapshot().sessions.map((s) => s.id);
    importGuest(A, 1);
    const ids = getSnapshot().sessions.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(own)); // nothing the account had was replaced
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
    expect(raw(STORAGE_KEY)).toBe(guestLessons); // the guest copy is untouched, not moved, not deleted
    expect(raw(GUIDED)).toBe(guestGuided);
  });

  it("is idempotent: adding twice changes nothing more", () => {
    playQuestions(8);
    setStorageScope(A);
    importGuest(A, 1);
    const once = raw(`${STORAGE_KEY}:u:${A}`);
    importGuest(A, 2);
    expect(raw(`${STORAGE_KEY}:u:${A}`)).toBe(once);
  });

  it("refuses to run unless that account's own folder is the active one (so it can never merge the guest into the guest, or into someone else)", () => {
    playQuestions(8);
    expect(() => importGuest(A, 1)).toThrow(); // browser is on the guest's folder
    setStorageScope(B);
    expect(() => importGuest(A, 1)).toThrow(); // browser is on B's folder
    expect(() => importGuest("", 1)).toThrow();
    expect(getSnapshot().sessions).toEqual([]);
  });

  it("is remembered: the same progress is not offered again to the same account, but is flagged if offered to a different one", () => {
    playQuestions(8);
    const fp = summarizeGuest(readGuest()).fingerprint;
    setStorageScope(A);
    expect(alreadyAddedTo(A, fp)).toBe(false);
    importGuest(A, 1);
    expect(alreadyAddedTo(A, fp)).toBe(true);
    expect(addedToAnotherAccount(B, fp)).toBe(true); // B is warned that this has already gone to an account here
    expect(alreadyAddedTo(B, fp)).toBe(false);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(`"${A}"`); // the ledger holds a one-way tag, not the account id
  });

  it("when the guest learns something new, it is offered again", () => {
    playQuestions(8);
    setStorageScope(A);
    importGuest(A, 1);
    setStorageScope("");
    guestActivity();
    const next = summarizeGuest(readGuest()).fingerprint;
    expect(alreadyAddedTo(A, next)).toBe(false);
  });
});

describe("the import card asks first, and declining costs nothing", () => {
  async function card(userId: string) {
    const { ImportCard } = await import("./ui/ImportCard");
    return render(<ImportCard userId={userId} />);
  }

  it("is not shown to a guest, to a different account, or when there is no guest progress", async () => {
    playQuestions(8);
    let r = await card(A); // browser is on the guest's folder
    expect(r.container).toBeEmptyDOMElement();
    r.unmount();
    setStorageScope(B);
    r = await card(A); // signed in as B, card for A
    expect(r.container).toBeEmptyDOMElement();
    r.unmount();
    resetApp();
    setStorageScope(A);
    r = await card(A); // no guest progress at all
    expect(r.container).toBeEmptyDOMElement();
  });

  it("explains plainly what will happen, shows what was found, and changes NOTHING until the learner agrees", async () => {
    playQuestions(8);
    guestActivity();
    const before = JSON.stringify({ ...window.localStorage });
    setStorageScope(A);
    await card(A);
    const box = await screen.findByTestId("import-card");
    expect(within(box).getByTestId("import-summary")).toHaveTextContent(/1 lesson finished.*1 Guided Correction session.*Only add it if it’s yours/);
    expect(box).toHaveTextContent(/stays on this device, unchanged/);
    expect(box).toHaveTextContent(/nothing is replaced/);
    expect(box).toHaveTextContent(/saved there too, including the answers you typed/);
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
    expect(getSnapshot().sessions).toEqual([]);
    expect(enable).not.toHaveBeenCalled();
  });

  it("'Not now' hides it and changes nothing", async () => {
    playQuestions(8);
    setStorageScope(A);
    await card(A);
    const before = JSON.stringify({ ...window.localStorage });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("import-card")).not.toBeInTheDocument();
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
    expect(getSnapshot().sessions).toEqual([]);
    expect(enable).not.toHaveBeenCalled();
  });

  it("'Add to my account' merges, turns saving on (that is the consent), and says so", async () => {
    playQuestions(8);
    setStorageScope(A);
    await card(A);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Add to my account" }));
    expect(await screen.findByTestId("import-done")).toHaveTextContent(/guest copy on this device is unchanged/);
    expect(getSnapshot().sessions).toHaveLength(1);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("the confirmation survives the dashboard re-creating the card (it does, the moment the account has progress)", async () => {
    playQuestions(8);
    setStorageScope(A);
    const first = await card(A);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Add to my account" }));
    expect(await screen.findByTestId("import-done")).toBeInTheDocument();
    first.unmount();
    await card(A); // a brand-new instance, as after the layout switch
    expect(await screen.findByTestId("import-done")).toBeInTheDocument();
  });

  it("warns when this same progress already went to an account on this device", async () => {
    playQuestions(8);
    setStorageScope(A);
    importGuest(A, 1);
    setStorageScope(B);
    await card(B);
    expect(await screen.findByRole("alert")).toHaveTextContent(/already added to an account on this device/);
  });
});
