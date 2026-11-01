import "@/tests/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listSkills } from "@/curriculum";
import { buildItemPool, createRun, recordResponse, selectNextItem } from "@/features/diagnostic/engine";
import { startSession } from "@/features/practice/actions";
import { dispatchGuided, startGuidedSession } from "@/features/guided/store/actions";
import { guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { updateState } from "@/lib/storage/store";
import { lesson, playQuestions, resetApp, router } from "@/tests/helpers";
import { Dashboard } from "./Dashboard";

const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const show = (over: Partial<Parameters<typeof Dashboard>[0]> = {}) => render(<Dashboard userId={ANA} displayName="Ana" practising={[]} welcome={false} {...over} />);
const skipOnboarding = () => updateState((s) => ({ ...s, onboarding: { ...s.onboarding, status: "skipped" } }));

/** Guided Correction activity of every kind, through the real store (so these are the real saved shapes). */
function seedGuided() {
  const NOW = 1_800_000_000_000;
  startGuidedSession({ now: NOW, id: "g1" });
  const send = (e: Parameters<typeof dispatchGuided>[1], t: number) => dispatchGuided("g1", e, { now: NOW + t, aiAvailable: true });
  send({ type: "EDIT", draft: "I have watched a film yesterday evening." }, 1);
  send({ type: "SUBMIT" }, 2);
  send({ type: "REQUEST_HINT" }, 3);
  send({ type: "EDIT", draft: "I watched a film with my sister." }, 4);
  send({ type: "SUBMIT" }, 5);
  startGuidedSession({ now: NOW + 20, id: "g2" });
  dispatchGuided("g2", { type: "SHOW_ME" }, { now: NOW + 21 });
}

beforeEach(() => {
  setStorageScope(ANA); // Ana is signed in on this browser: her progress lives in her own folder
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
  router.push.mockClear();
});

describe("dashboard: a brand-new account", () => {
  it("offers one clear first step, with no empty charts or zero scores", async () => {
    show();
    const box = await screen.findByTestId("dashboard-new");
    expect(within(box).getByRole("heading", { name: "Let’s find your starting point" })).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: "Start the quick check" })).toHaveAttribute("href", "/onboarding");
    expect(within(box).getByRole("link", { name: "Pick a lesson myself" })).toHaveAttribute("href", "/library");
    expect(screen.queryByTestId("dashboard-skills")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile")).not.toBeInTheDocument();
  });

  it("greets the learner and says plainly that progress is on THIS DEVICE (cloud sync is not part of this release)", async () => {
    show({ displayName: "Ana" });
    expect(await screen.findByTestId("dashboard-greeting")).toHaveTextContent("Hi, Ana");
    expect(screen.getByText("Progress on this device")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/saved to your account/i);
  });

  it("links the avatar to the profile and shows the welcome note after joining", async () => {
    show({ welcome: true });
    expect(await screen.findByRole("link", { name: "Your profile" })).toHaveAttribute("href", "/account/profile");
    expect(screen.getByTestId("welcome-note")).toHaveTextContent(/Your account is ready/);
    expect(screen.getByRole("link", { name: "Set up your profile" })).toHaveAttribute("href", "/account/profile/edit");
  });
});

describe("dashboard: real progress on this device", () => {
  it("shows the next lesson with the app's own reason, the skills so far, strengths and the early-read caveat", async () => {
    skipOnboarding();
    playQuestions(8);
    show();
    expect(await screen.findByTestId("dashboard-next")).toHaveTextContent(/YOUR NEXT STEP/);
    expect(screen.getByTestId("dashboard-next-reason").textContent?.length).toBeGreaterThan(20);
    expect(screen.getByRole("link", { name: "Start practice" }).getAttribute("href")).toMatch(/^\/practice\//);
    const skills = screen.getByTestId("dashboard-skills");
    expect(within(skills).getByTestId("profile")).toBeInTheDocument();
    expect(within(skills).getByTestId("profile-caveat")).toHaveTextContent(/not a CEFR level/);
    expect(screen.getByTestId("dashboard-caveat")).toHaveTextContent(/not in your account/);
    expect(document.body).not.toHaveTextContent(/saved to your account\. your lessons and progress/i);
  });

  it("continues an unfinished lesson where it stopped, with a real progress bar", async () => {
    skipOnboarding();
    playQuestions(3);
    show();
    const box = await screen.findByTestId("dashboard-continue");
    expect(within(box).getByText(lesson.title)).toBeInTheDocument();
    expect(within(box).getByRole("progressbar", { name: "Lesson progress" })).toHaveAttribute("aria-valuenow", "3");
    expect(within(box).getByRole("link", { name: "Continue lesson" })).toHaveAttribute("href", `/practice/${lesson.id}/session`);
    expect(box).toHaveTextContent(/Question 4 of 8/);
  });

  it("reports the quick check from the real saved run: when, how many answers, how many skills it gave evidence on", async () => {
    const skills = listSkills();
    const pool = buildItemPool(skills);
    let run = createRun("d1", ["a2-past-simple"], 1_800_000_000_000);
    for (let i = 0; i < 8; i++) {
      const item = selectNextItem(run, pool, skills);
      if (!item) break;
      run = recordResponse(run, item, item.skillId === "a2-past-simple" ? "incorrect" : "correct", 1_800_000_000_000 + i);
    }
    run = { ...run, finishedAt: 1_800_000_100_000 };
    updateState((s) => ({ ...s, diagnosticRuns: [run], onboarding: { ...s.onboarding, status: "completed" } }));
    show();
    const box = await screen.findByTestId("dashboard-diagnostic");
    expect(box).toHaveTextContent(new RegExp(`${run.responses.length} answers`));
    expect(box).toHaveTextContent(/early evidence on \d+ skills?/);
    expect(await screen.findByTestId("dashboard-skills")).toHaveTextContent(/Worth working on/);
  });

  it("says so, kindly, when the quick check has not been taken, and lets the learner take it", async () => {
    skipOnboarding();
    playQuestions(8);
    const user = userEvent.setup();
    show();
    const box = await screen.findByTestId("dashboard-diagnostic");
    expect(box).toHaveTextContent(/haven’t taken the quick check yet/);
    await user.click(within(box).getByRole("button", { name: "Take the quick check" }));
    expect(router.push).toHaveBeenCalledWith("/onboarding");
  });

  it("shows the topics the learner chose, labelled as saved to the account but not yet applied to lessons", async () => {
    skipOnboarding();
    playQuestions(8);
    show({ practising: ["Conditionals", "Prepositions"] });
    const box = await screen.findByTestId("dashboard-goals");
    expect(box).toHaveTextContent("Conditionals");
    expect(box).toHaveTextContent("Prepositions");
    expect(box).toHaveTextContent(/later update/);
    expect(within(box).getByRole("link", { name: "Edit profile and goals" })).toHaveAttribute("href", "/account/profile/edit");
  });

  it("an unfinished lesson alone is not shown as a skill (no evidence is not weakness)", async () => {
    skipOnboarding();
    startSession(lesson);
    show();
    expect(await screen.findByTestId("dashboard-skills")).toHaveTextContent(/Nothing is “weak” until we have evidence/);
  });
});

describe("dashboard: Guided Correction is never mastery or proficiency", () => {
  it("appears only when there is activity, as counts, labelled Beta and provisional and separate from lesson progress", async () => {
    skipOnboarding();
    playQuestions(8);
    show();
    await screen.findByTestId("dashboard-skills");
    expect(screen.queryByTestId("guided-activity")).not.toBeInTheDocument();
  });

  it("shows plain counts with the provisional, separate-from-lessons note, and no score, level, mastery or percentage wording", async () => {
    skipOnboarding();
    playQuestions(8);
    seedGuided();
    show();
    const card = await screen.findByTestId("guided-activity");
    expect(within(card).getByText("Beta")).toBeInTheDocument();
    expect(card).toHaveTextContent(/Practice activity, kept separate from your lesson progress\. Provisional while we check what it means\./);
    expect(card).toHaveTextContent(/first try/);
    expect(card).toHaveTextContent(/fixed it yourself/);
    expect(card).toHaveTextContent(/1 fixed with a hint/); // what the seeded activity really was
    expect(card.textContent).not.toMatch(/\b(mastery|master(ed)?|proficien\w*|fluen\w*|levels?|scores?|graded?|CEFR|[ABC][12]|strong|developing)\b|%|\d\.\d/i);
    expect(within(card).queryByTestId("profile")).not.toBeInTheDocument();
  });

  it("changes NOTHING about skills, strengths, weaknesses or the next step: they are identical with and without guided activity", async () => {
    skipOnboarding();
    playQuestions(8, { stumbleOnQ2: true });
    const snapshot = async () => {
      const { unmount } = show();
      const text = {
        skills: (await screen.findByTestId("dashboard-skills")).textContent,
        next: screen.getByTestId("dashboard-next").textContent,
        strengths: screen.queryByTestId("profile-strengths")?.textContent ?? null,
        weaknesses: screen.queryByTestId("profile-weaknesses")?.textContent ?? null,
        headline: screen.getByTestId("profile-headline").textContent,
      };
      unmount();
      return text;
    };
    const before = await snapshot();
    seedGuided();
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(before.skills!.length).toBeGreaterThan(50);
  });
});
