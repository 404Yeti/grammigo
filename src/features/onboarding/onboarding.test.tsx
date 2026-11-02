import "@/tests/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listSkills } from "@/curriculum";
import { selectNextItem } from "@/features/diagnostic/engine";
import { diagnosticPool } from "./actions";
import { getSnapshot, updateState } from "@/lib/storage/store";
import { getActiveSession } from "@/features/practice/selectors";
import { resetApp, router } from "@/tests/helpers";

const ai = vi.hoisted(() => ({
  status: { available: false },
  goals: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/features/ai/client", () => ({
  fetchAiStatus: async () => ai.status,
  requestGoals: (...a: unknown[]) => ai.goals(...a),
  requestTranscription: (...a: unknown[]) => ai.transcribe(...a),
  requestWritingFeedback: async () => null,
}));

// The recorder itself needs a real microphone; the flow only cares that it hands over audio.
vi.mock("./VoiceRecorder", () => ({
  VoiceRecorder: ({ onAudio }: { onAudio: (b: Blob) => void }) => (
    <button onClick={() => onAudio(new Blob(["x"], { type: "audio/webm" }))}>Speak it</button>
  ),
}));

import { OnboardingFlow } from "./OnboardingFlow";

const skills = listSkills();
const pool = diagnosticPool();

beforeEach(() => {
  resetApp();
  router.push.mockClear();
  router.replace.mockClear();
  ai.status = { available: false };
  ai.goals.mockReset();
  ai.transcribe.mockReset();
});

const ob = () => getSnapshot().onboarding;

/** Answers whatever the adaptive quiz is currently asking, correctly or not. */
async function answerCurrent(user: ReturnType<typeof userEvent.setup>, correct: boolean) {
  const state = getSnapshot();
  const run = state.diagnosticRuns.find((r) => r.id === state.onboarding.runId)!;
  const item = selectNextItem(run, pool, skills)!;
  const q = item.question;
  if (q.options) {
    const right = q.acceptedAnswers[0];
    const pick = q.options.find((o) => (correct ? o.id === right : o.id !== right))!;
    await user.click(screen.getByLabelText(pick.label));
  } else {
    await user.type(screen.getByLabelText("Your answer"), correct ? q.acceptedAnswers[0] : "zzz");
  }
  await user.click(screen.getByRole("button", { name: "Next" }));
}

async function toQuiz(user: ReturnType<typeof userEvent.setup>, text = "I mix up past tenses") {
  render(<OnboardingFlow />);
  await user.click(await screen.findByRole("button", { name: "Type it" }));
  await user.type(screen.getByLabelText("Tell Migo in your own words"), text);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Start the quick check" }));
}

describe("welcome", () => {
  it("Migo introduces himself and asks the question, with type, speak and skip options", async () => {
    ai.status = { available: true };
    render(<OnboardingFlow />);
    expect(await screen.findByText("What would you like to improve about your English?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type it" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Speak it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip, start a general grammar check/ })).toBeInTheDocument();
    expect(ob().status).toBe("in_progress");
  });

  it("never asks the learner to choose a CEFR level", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    expect(document.body.textContent).not.toMatch(/choose your level|select your level|what is your level|A1|A2|B1|B2/i);
  });

  it("explains honestly when voice is unavailable and keeps typing fully usable", async () => {
    render(<OnboardingFlow />);
    expect(await screen.findByTestId("voice-unavailable")).toHaveTextContent(/Voice isn’t available/);
    expect(screen.getByRole("button", { name: "Type it" })).toBeEnabled();
  });

  it("skipping the conversation starts a general grammar check with no goals", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: /Skip, start a general grammar check/ }));
    expect(await screen.findByText(/Quick check · question 1/)).toBeInTheDocument();
    expect(getSnapshot().goals?.skillIds).toEqual([]);
    expect(getSnapshot().goals?.extractedBy).toBe("none");
  });

  it("'Not now' leaves onboarding and returns Home without a forced check", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(router.replace).toHaveBeenCalledWith("/learn");
    expect(ob().status).toBe("skipped");
  });
});

describe("typed concerns → goals", () => {
  it("interprets typed words offline when AI is unavailable and shows removable goal chips", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.type(screen.getByLabelText("Tell Migo in your own words"), "I always mix up past simple and present perfect, and articles");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const chips = await screen.findByTestId("goal-chips");
    expect(getSnapshot().goals?.extractedBy).toBe("local");
    expect(within(chips).getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(getSnapshot().goals?.skillIds).toContain("present-perfect-vs-past-simple");

    const before = getSnapshot().goals!.skillIds.length;
    await user.click(within(chips).getAllByRole("button", { name: /^Remove/ })[0]);
    expect(getSnapshot().goals!.skillIds.length).toBeLessThan(before);
  });

  it("uses the AI interpretation when available", async () => {
    ai.status = { available: true };
    ai.goals.mockResolvedValue({ goals: [{ label: "Conditionals", skillIds: ["b1-first-conditional"] }], skillIds: ["b1-first-conditional"], summary: "x" });
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.type(screen.getByLabelText("Tell Migo in your own words"), "if sentences are hard");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByTestId("goal-chips");
    expect(ai.goals).toHaveBeenCalledWith("if sentences are hard");
    expect(getSnapshot().goals?.extractedBy).toBe("ai");
    expect(getSnapshot().goals?.skillIds).toEqual(["b1-first-conditional"]);
  });

  it("falls back to offline matching when the AI call fails", async () => {
    ai.status = { available: true };
    ai.goals.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.type(screen.getByLabelText("Tell Migo in your own words"), "articles confuse me");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByTestId("goal-chips");
    expect(getSnapshot().goals?.extractedBy).toBe("local");
    expect(getSnapshot().goals?.skillIds).toContain("a1-articles");
  });

  it("handles text it cannot place with a friendly general check", async () => {
    const user = userEvent.setup();
    await toQuiz(user, "hello there my friend");
    expect(getSnapshot().goals?.skillIds).toEqual([]);
  });
});

describe("spoken concerns → transcript confirmation", () => {
  it("transcribes, lets the learner edit the transcript, then interprets the edited text", async () => {
    ai.status = { available: true };
    ai.transcribe.mockResolvedValue("I mess up articles");
    ai.goals.mockResolvedValue({ goals: [{ label: "Articles", skillIds: ["a1-articles"] }], skillIds: ["a1-articles"], summary: "x" });
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.click(await screen.findByRole("button", { name: "Speak it" }));

    const box = await screen.findByLabelText("Your words");
    expect(box).toHaveValue("I mess up articles");
    expect(ob().draftSource).toBe("spoken");
    await user.clear(box);
    await user.type(box, "I mix up articles");
    await user.click(screen.getByRole("button", { name: "Looks good" }));
    await screen.findByTestId("goal-chips");
    expect(ai.goals).toHaveBeenCalledWith("I mix up articles");
    expect(getSnapshot().goals?.source).toBe("spoken");
  });

  it("stays on the typing screen with a helpful message if transcription fails", async () => {
    ai.status = { available: true };
    ai.transcribe.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.click(await screen.findByRole("button", { name: "Speak it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t turn that into text/);
    expect(screen.getByLabelText("Tell Migo in your own words")).toBeEnabled();
  });
});

describe("adaptive quiz", () => {
  it("is deterministic, shows one question at a time, and never reveals right/wrong mid-check", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    expect(await screen.findByText(/Quick check · question 1/)).toBeInTheDocument();
    await answerCurrent(user, false);
    expect(await screen.findByText(/Quick check · question 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Correct|Not quite/)).not.toBeInTheDocument();
  });

  it("can skip individual questions, and skipped questions are not counted as wrong", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    await user.click(await screen.findByRole("button", { name: "Skip this one" }));
    const run = getSnapshot().diagnosticRuns[0];
    expect(run.responses[0].outcome).toBe("skipped");
  });

  it("disables Next until something is answered", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    expect(await screen.findByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("refresh/resume: returns to the same quiz question with progress intact", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    await answerCurrent(user, true);
    await answerCurrent(user, true);
    await screen.findByText(/Quick check · question 3/);
    const expectedNext = selectNextItem(getSnapshot().diagnosticRuns[0], pool, skills)!;

    // simulate a refresh: drop the component and the in-memory cache, keep localStorage
    document.body.innerHTML = "";
    const { resetStoreCache } = await import("@/lib/storage/store");
    resetStoreCache();
    render(<OnboardingFlow />);
    expect(await screen.findByText(/Quick check · question 3/)).toBeInTheDocument();
    expect(selectNextItem(getSnapshot().diagnosticRuns[0], pool, skills)!.id).toBe(expectedNext.id);
    expect(getSnapshot().diagnosticRuns).toHaveLength(1); // resuming did not start a second run
  });

  it("refresh/resume: restores typed text on the concerns screen", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);
    await user.click(await screen.findByRole("button", { name: "Type it" }));
    await user.type(screen.getByLabelText("Tell Migo in your own words"), "conditionals");
    document.body.innerHTML = "";
    const { resetStoreCache } = await import("@/lib/storage/store");
    resetStoreCache();
    render(<OnboardingFlow />);
    expect(await screen.findByLabelText("Tell Migo in your own words")).toHaveValue("conditionals");
  });
});

describe("profile → first lesson (the acceptance journey)", () => {
  async function finishQuiz(user: ReturnType<typeof userEvent.setup>, policy: (n: number) => boolean) {
    for (let n = 1; n < 20; n++) {
      if (screen.queryByTestId("onboarding-profile")) break;
      await screen.findByText(new RegExp(`Quick check · question ${n}`));
      await answerCurrent(user, policy(n));
    }
    return screen.findByTestId("onboarding-profile");
  }

  it("tell Migo → quick adaptive check → profile → one recommended lesson → start it, never choosing a level", async () => {
    const user = userEvent.setup();
    await toQuiz(user, "I mix up past tenses");
    await finishQuiz(user, (n) => n % 2 === 1);

    const run = getSnapshot().diagnosticRuns[0];
    expect(run.responses.length).toBeGreaterThanOrEqual(5);
    expect(run.responses.length).toBeLessThanOrEqual(10);
    expect(screen.getByTestId("profile-caveat")).toHaveTextContent(/not a CEFR level/);

    await user.click(screen.getByRole("button", { name: "See my first lesson" }));
    const card = await screen.findByTestId("first-lesson");
    expect(within(card).getByTestId("first-lesson-reason").textContent!.length).toBeGreaterThan(30);

    await user.click(screen.getByRole("button", { name: "Start My First Lesson" }));
    const active = getActiveSession(getSnapshot())!;
    expect(active).not.toBeNull();
    expect(router.push).toHaveBeenCalledWith(`/practice/${active.lessonId}/session`);
    expect(ob().status).toBe("completed");
    expect(getSnapshot().lastRecommendation?.skillId).toBe(active.lessonId);
  });

  it("a mixed-level learner is routed to the gap, not to the hardest lesson", async () => {
    const user = userEvent.setup();
    await toQuiz(user, "reported speech and conditionals");
    // strong everywhere except one A2 foundation skill
    for (let n = 1; n < 20 && !screen.queryByTestId("onboarding-profile"); n++) {
      await screen.findByText(new RegExp(`Quick check · question ${n}`));
      const state = getSnapshot();
      const item = selectNextItem(state.diagnosticRuns[0], pool, skills)!;
      await answerCurrent(user, item.skillId !== "a2-past-simple");
    }
    await screen.findByTestId("onboarding-profile");
    expect(screen.getByTestId("profile-weaknesses")).toHaveTextContent(/Past simple/);
    await user.click(screen.getByRole("button", { name: "See my first lesson" }));
    expect(await screen.findByTestId("first-lesson")).toHaveTextContent(/Past simple/);
  });

  it("skipping every question yields an honest 'not enough evidence' profile, never weaknesses", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    for (let i = 0; i < 3; i++) await user.click(await screen.findByRole("button", { name: "Skip this one" }));
    await screen.findByTestId("onboarding-profile");
    expect(screen.queryByTestId("profile-weaknesses")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-headline")).toHaveTextContent(/don’t have evidence/);
  });

  it("offers an optional extension when the picture is inconclusive", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    // skip two of every three questions (never three in a row)
    for (let n = 1; n < 20 && !screen.queryByTestId("onboarding-profile"); n++) {
      await screen.findByText(new RegExp(`Quick check · question ${n}`));
      if (n % 3 === 0) await answerCurrent(user, true);
      else await user.click(screen.getByRole("button", { name: "Skip this one" }));
    }
    await screen.findByTestId("onboarding-profile");
    expect(screen.getByTestId("extend-offer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Answer a few more questions" }));
    expect(await screen.findByText(/Quick check · question 11/)).toBeInTheDocument();
  });

  it("lets the learner browse instead of starting the suggested lesson", async () => {
    const user = userEvent.setup();
    await toQuiz(user);
    await finishQuiz(user, () => true);
    await user.click(screen.getByRole("button", { name: "See my first lesson" }));
    await user.click(await screen.findByRole("button", { name: "Browse all lessons" }));
    expect(router.push).toHaveBeenCalledWith("/library");
  });
});

describe("returning learners", () => {
  it("a completed learner is sent Home, not through onboarding again", async () => {
    updateState((s) => ({ ...s, onboarding: { ...s.onboarding, status: "completed" } }));
    render(<OnboardingFlow />);
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledWith("/learn");
  });
});
