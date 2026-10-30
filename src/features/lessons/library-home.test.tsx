import "@/tests/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryScreen } from "./LibraryScreen";
import { HomeScreen } from "./HomeScreen";
import { updateState } from "@/lib/storage/store";
import { createRun, recordResponse, selectNextItem, buildItemPool } from "@/features/diagnostic/engine";
import { listSkills } from "@/curriculum";
import { playQuestions, resetApp, router } from "@/tests/helpers";
import { startSession } from "@/features/practice/actions";
import { lesson } from "@/tests/helpers";

const skipOnboarding = () => updateState((s) => ({ ...s, onboarding: { ...s.onboarding, status: "skipped" } }));

beforeEach(() => {
  resetApp();
  router.push.mockClear();
  router.replace.mockClear();
});

describe("Grammar library", () => {
  it("lists every lesson with level, topic, duration, completion and mastery status", async () => {
    skipOnboarding();
    render(<LibraryScreen />);
    const cards = await screen.findAllByTestId("lesson-card");
    expect(cards).toHaveLength(12);
    const first = cards[0];
    expect(first).toHaveAttribute("data-skill", "a1-be-present");
    expect(within(first).getByText("Not assessed")).toBeInTheDocument();
    expect(within(first).getByTestId("completion")).toHaveTextContent("Not started");
  });

  it("recommends a lesson with a reason, and nothing is locked", async () => {
    skipOnboarding();
    render(<LibraryScreen />);
    const rec = await screen.findByTestId("library-recommended");
    expect(rec).toHaveTextContent(/don’t have any evidence/);
    // a B2 lesson is reachable immediately: levels are labels, not gates
    const b2 = screen.getAllByTestId("lesson-card").find((c) => c.getAttribute("data-skill") === "b2-reported-speech")!;
    expect(within(b2).getByRole("link")).toHaveAttribute("href", "/practice/b2-reported-speech");
  });

  it("filters by CEFR level and topic; C1/C2 are shown as unavailable", async () => {
    skipOnboarding();
    const user = userEvent.setup();
    render(<LibraryScreen />);
    await screen.findAllByTestId("lesson-card");

    const levels = screen.getByRole("group", { name: "Level" });
    expect(within(levels).getByRole("button", { name: /C1/ })).toBeDisabled();
    expect(within(levels).getByRole("button", { name: /C2/ })).toBeDisabled();

    await user.click(within(levels).getByRole("button", { name: "B2" }));
    expect(screen.getAllByTestId("lesson-card").map((c) => c.getAttribute("data-skill")).sort()).toEqual(["b2-reported-speech", "b2-second-third-conditionals"]);

    await user.click(within(levels).getByRole("button", { name: "All levels" }));
    await user.click(within(screen.getByRole("group", { name: "Topic" })).getByRole("button", { name: "Conditionals" }));
    expect(screen.getAllByTestId("lesson-card").map((c) => c.getAttribute("data-skill")).sort()).toEqual(["b1-first-conditional", "b2-second-third-conditionals"]);
  });

  it("shows completion and mastery after a lesson, as an early read rather than mastery", async () => {
    playQuestions(8);
    render(<LibraryScreen />);
    const card = (await screen.findAllByTestId("lesson-card")).find((c) => c.getAttribute("data-skill") === "present-perfect-vs-past-simple")!;
    expect(within(card).getByTestId("completion")).toHaveTextContent("Completed 1×");
    expect(within(card).queryByText("Strong")).not.toBeInTheDocument(); // one perfect lesson is not mastery
  });

  it("marks an unfinished lesson as in progress", async () => {
    startSession(lesson);
    render(<LibraryScreen />);
    const card = (await screen.findAllByTestId("lesson-card")).find((c) => c.getAttribute("data-skill") === lesson.id)!;
    expect(within(card).getByTestId("completion")).toHaveTextContent("In progress");
  });
});

describe("personalized Home", () => {
  it("after a diagnostic, recommends from the learner's actual evidence and says why", async () => {
    const skills = listSkills();
    const pool = buildItemPool(skills);
    // learner misses everything about the past simple, gets the rest right
    let run = createRun("d1", ["a2-past-simple"], 1_800_000_000_000);
    for (let i = 0; i < 8; i++) {
      const item = selectNextItem(run, pool, skills);
      if (!item) break;
      run = recordResponse(run, item, item.skillId === "a2-past-simple" ? "incorrect" : "correct", 1_800_000_000_000 + i);
    }
    updateState((s) => ({ ...s, diagnosticRuns: [run], goals: { text: "past tense", source: "typed", goals: [{ label: "Past simple", skillIds: ["a2-past-simple"] }], skillIds: ["a2-past-simple"], extractedBy: "local", updatedAt: 1 }, onboarding: { ...s.onboarding, status: "completed" } }));

    render(<HomeScreen />);
    const text = await screen.findByTestId("next-step-text");
    expect(text).toHaveTextContent(/Past simple/);
    expect(screen.getByTestId("home-profile")).toHaveTextContent(/Needs practice/);
    expect(screen.getByTestId("home-profile")).toHaveTextContent(/not a CEFR level/);
    expect(screen.getByRole("link", { name: "Start Practice" })).toHaveAttribute("href", "/practice/a2-past-simple");
    expect(screen.getByRole("link", { name: "Choose another lesson" })).toHaveAttribute("href", "/library");
  });

  it("explains what the learner just did and why the next step is what it is", async () => {
    skipOnboarding();
    updateState((s) => ({ ...s, lastRecommendation: { skillId: "a1-articles", kind: "new", at: 1 } }));
    playQuestions(8, { stumbleOnQ2: true });
    render(<HomeScreen />);
    const text = await screen.findByTestId("next-step-text");
    expect(text).toHaveTextContent(/You finished “Present Perfect vs. Past Simple” with 7 of 8 answers on your own/);
    expect(text).toHaveTextContent(/Last time we suggested “Articles: a, an, the”; now we suggest/);
  });

  it("lets a learner update goals or retake the check later", async () => {
    skipOnboarding();
    const user = userEvent.setup();
    playQuestions(8);
    render(<HomeScreen />);
    await user.click(await screen.findByRole("button", { name: "Retake the quick check" }));
    expect(router.push).toHaveBeenCalledWith("/onboarding");
  });
});
