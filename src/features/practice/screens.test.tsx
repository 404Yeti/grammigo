import "@/tests/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "@/features/lessons/HomeScreen";
import { IntroScreen } from "@/features/lessons/IntroScreen";
import { CompleteScreen } from "./CompleteScreen";
import { ReviewScreen } from "./ReviewScreen";
import { SessionScreen } from "./SessionScreen";
import { getSnapshot } from "@/lib/storage/store";
import { getActiveSession, getCompletedSessions } from "./selectors";
import { lesson, playQuestions, resetApp, router } from "@/tests/helpers";
import { practiceActions, startSession } from "./actions";

beforeEach(() => {
  resetApp();
  router.push.mockClear();
  router.replace.mockClear();
});

describe("Home", () => {
  it("offers Start Practice on a fresh install, linking to the lesson", async () => {
    render(<HomeScreen />);
    const link = await screen.findByRole("link", { name: "Start Practice" });
    expect(link).toHaveAttribute("href", `/practice/${lesson.id}`);
    expect(screen.getByText(/Nothing is “weak”/)).toBeInTheDocument();
  });

  it("shows Continue Lesson for an unfinished session", async () => {
    const id = startSession(lesson);
    practiceActions.setDraft(id, "b");
    practiceActions.submit(id, lesson);
    practiceActions.advance(id);
    render(<HomeScreen />);
    const link = await screen.findByRole("link", { name: "Continue Lesson" });
    expect(link).toHaveAttribute("href", `/practice/${lesson.id}/session`);
    expect(screen.getByTestId("next-step-text")).toHaveTextContent("question 2 of 8");
  });

  it("shows the updated session summary after a lesson is completed (Return Home)", async () => {
    playQuestions(8, { stumbleOnQ2: true });
    render(<HomeScreen />);
    expect(await screen.findByTestId("home-independent")).toHaveTextContent("7");
    expect(screen.getByTestId("home-assisted")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "Start Practice" })).toBeInTheDocument();
  });
});

describe("Lesson introduction", () => {
  it("starts a new session and opens the first question", async () => {
    render(<IntroScreen lessonId={lesson.id} />);
    expect(screen.getByRole("heading", { name: lesson.title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start Lesson" }));
    expect(router.push).toHaveBeenCalledWith(`/practice/${lesson.id}/session`);
    expect(getActiveSession(getSnapshot(), lesson.id)).not.toBeNull();
  });

  it("goes back to Home", () => {
    render(<IntroScreen lessonId={lesson.id} />);
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
  });
});

describe("Session screen", () => {
  it("cannot be submitted before an answer is chosen", async () => {
    startSession(lesson);
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByRole("button", { name: "Check Answer" })).toBeDisabled();
  });

  it("correct first answer: independent feedback, then Continue advances", async () => {
    startSession(lesson);
    const user = userEvent.setup();
    render(<SessionScreen lessonId={lesson.id} />);
    await user.click(await screen.findByLabelText("I have visited Hanoi twice."));
    await user.click(screen.getByRole("button", { name: "Check Answer" }));
    expect(screen.getByTestId("feedback-chip")).toHaveTextContent("Counts as independent");
    expect(screen.getByTestId("announcer")).toHaveTextContent("Exactly!");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Question 2 of 8")).toBeInTheDocument();
    expect(screen.getByLabelText("Your answer")).toBeInTheDocument();
  });

  it("wrong answer → hint → retry → corrected after help", async () => {
    startSession(lesson);
    const user = userEvent.setup();
    render(<SessionScreen lessonId={lesson.id} />);
    await user.click(await screen.findByLabelText("I visited Hanoi last year."));
    await user.click(screen.getByRole("button", { name: "Check Answer" }));

    const panel = screen.getByTestId("feedback-panel");
    expect(panel).toHaveAttribute("data-kind", "incorrect");
    expect(within(panel).getByText("Not quite.")).toBeInTheDocument(); // explains, never a bare "Wrong"

    await user.click(within(panel).getByRole("button", { name: "Get a hint" }));
    expect(screen.getByTestId("hint-card")).toHaveTextContent("Hint 1 of 2");
    // back to answering: choice cleared, Try again is disabled until a new choice
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();

    await user.click(screen.getByLabelText("I have visited Hanoi twice."));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByTestId("feedback-chip")).toHaveTextContent("Corrected after help");
    const record = getActiveSession(getSnapshot(), lesson.id)!.records[0];
    expect(record.classification).toBe("correct_after_hint");
    expect(record.hintsUsed).toBe(1);
  });

  it("explains why on request and offers Try again", async () => {
    startSession(lesson);
    const user = userEvent.setup();
    render(<SessionScreen lessonId={lesson.id} />);
    await user.click(await screen.findByLabelText("I was visiting Hanoi."));
    await user.click(screen.getByRole("button", { name: "Check Answer" }));
    await user.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByTestId("why-text")).toHaveTextContent("links a past experience to now");
  });

  it("a typed question accepts the answer with Enter and shows validation for an unchanged retry", async () => {
    const id = startSession(lesson);
    practiceActions.setDraft(id, "b");
    practiceActions.submit(id, lesson);
    practiceActions.advance(id);
    const user = userEvent.setup();
    render(<SessionScreen lessonId={lesson.id} />);
    const input = await screen.findByLabelText("Your answer");
    await user.type(input, "watch{Enter}");
    expect(screen.getByTestId("feedback-panel")).toHaveAttribute("data-kind", "incorrect");
    await user.click(screen.getByRole("button", { name: "Try again" })); // ghost button returns to the field
    await user.click(screen.getByRole("button", { name: "Try again" })); // submit unchanged
    expect(screen.getByRole("alert")).toHaveTextContent(/Change something/);
    expect(getActiveSession(getSnapshot(), lesson.id)!.records[1].attempts).toHaveLength(1);
  });

  it("restores the saved question after a reload (resume)", async () => {
    const id = startSession(lesson);
    practiceActions.setDraft(id, "b");
    practiceActions.submit(id, lesson);
    practiceActions.advance(id);
    practiceActions.setDraft(id, "watch");
    render(<SessionScreen lessonId={lesson.id} />);
    expect(await screen.findByText("Question 2 of 8")).toBeInTheDocument();
    expect(screen.getByLabelText("Your answer")).toHaveValue("watch");
  });

  it("Exit asks before leaving and Save & Exit returns Home", async () => {
    startSession(lesson);
    const user = userEvent.setup();
    render(<SessionScreen lessonId={lesson.id} />);
    await user.click(await screen.findByRole("button", { name: "Exit lesson" }));
    expect(screen.getByRole("dialog", { name: "Leave this lesson?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue Lesson" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit lesson" }));
    await user.click(screen.getByRole("button", { name: /Save & Exit/ }));
    expect(router.push).toHaveBeenCalledWith("/");
    expect(getActiveSession(getSnapshot(), lesson.id)).not.toBeNull(); // progress kept
  });

  it("sends the learner to the introduction when no attempt is active", async () => {
    render(<SessionScreen lessonId={lesson.id} />);
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledWith(`/practice/${lesson.id}`);
  });
});

describe("Success → Review → Home", () => {
  it("shows accurate completion numbers and a Review My Lesson link", async () => {
    const id = playQuestions(8, { stumbleOnQ2: true });
    render(<CompleteScreen lessonId={lesson.id} sessionId={id} />);
    expect(await screen.findByText("You did it, amigo!")).toBeInTheDocument();
    const tiles = screen.getAllByTestId("stat-tile").map((t) => t.textContent);
    expect(tiles[0]).toContain("8");
    expect(tiles[1]).toContain("7");
    expect(tiles[2]).toContain("1");
    expect(screen.getByRole("link", { name: "Review My Lesson" })).toHaveAttribute(
      "href",
      `/practice/${lesson.id}/review?session=${id}`,
    );
  });

  it("review lists real attempt history and expands to show answers and help used", async () => {
    const id = playQuestions(8, { stumbleOnQ2: true });
    const user = userEvent.setup();
    render(<ReviewScreen lessonId={lesson.id} sessionId={id} />);
    expect(await screen.findByRole("heading", { name: "Your Lesson Review" })).toBeInTheDocument();
    expect(screen.getByTestId("review-topic")).toHaveTextContent(lesson.title);
    const cards = screen.getAllByTestId("review-card");
    expect(cards).toHaveLength(8);
    expect(cards[1]).toHaveAttribute("data-result", "correct_after_retry");
    expect(cards[0]).toHaveAttribute("data-result", "correct_first_try");

    await user.click(within(cards[1]).getByRole("button"));
    const details = within(cards[1]).getByTestId("review-details");
    expect(details).toHaveTextContent("Your answer");
    expect(details).toHaveTextContent("watch");
    expect(details).toHaveTextContent("Correct answer");
    expect(details).toHaveTextContent("1 retry");
    expect(screen.getByTestId("recommendation")).toBeInTheDocument();
  });

  it("Return Home goes to the dashboard", async () => {
    const id = playQuestions(8);
    render(<ReviewScreen lessonId={lesson.id} sessionId={id} />);
    expect(await screen.findByRole("link", { name: "Return Home" })).toHaveAttribute("href", "/");
  });

  it("Practice Again creates a new session without overwriting the completed one", async () => {
    const id = playQuestions(8);
    const user = userEvent.setup();
    render(<ReviewScreen lessonId={lesson.id} sessionId={id} />);
    await user.click(await screen.findByRole("button", { name: "Practice This Skill Again" }));
    const state = getSnapshot();
    const completed = getCompletedSessions(state, lesson.id);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(id);
    const fresh = getActiveSession(state, lesson.id)!;
    expect(fresh.id).not.toBe(id);
    expect(fresh.currentIndex).toBe(0);
    expect(fresh.records.every((r) => r.attempts.length === 0)).toBe(true);
    expect(router.push).toHaveBeenCalledWith(`/practice/${lesson.id}/session`);
  });

  it("redirects away when there is nothing to review", async () => {
    render(<ReviewScreen lessonId={lesson.id} />);
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledWith(`/practice/${lesson.id}`);
  });
});
