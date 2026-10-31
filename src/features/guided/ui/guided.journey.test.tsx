import "@/tests/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({
  available: true,
  transcript: "I watched a film yesterday evening." as string | null,
  transcribeCalls: 0,
}));
vi.mock("@/features/ai/client", () => ({
  fetchAiStatus: async () => ({ available: ai.available }),
  requestGoals: async () => null,
  requestWritingFeedback: async () => null,
  requestTranscription: async () => {
    ai.transcribeCalls += 1;
    return ai.transcript;
  },
}));
const opinion = vi.hoisted(() => ({
  next: { status: "ok", opinion: { fit: "fits", confidence: "high", suspected: null } } as unknown,
  pending: false,
  calls: [] as { itemId: string; text: string; source: string }[],
  release: null as null | (() => void),
}));
vi.mock("../ai/client", () => ({
  requestOpinion: (input: { itemId: string; text: string; source: string }, signal?: AbortSignal) => {
    opinion.calls.push(input);
    if (!opinion.pending) return Promise.resolve(opinion.next);
    return new Promise((resolve) => {
      opinion.release = () => resolve(opinion.next);
      signal?.addEventListener("abort", () => resolve({ status: "failed", reason: "unavailable" }));
    });
  },
}));

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntroScreen } from "@/features/lessons/IntroScreen";
import { resetApp, router } from "@/tests/helpers";
import { dispatchGuided, startGuidedSession } from "../store/actions";
import { getGuidedSnapshot, resetGuidedStoreCache } from "../store/store";
import { GuidedScreen } from "./GuidedScreen";

const LESSON = "present-perfect-vs-past-simple";

class FakeRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.onstop?.();
  }
}

function permission(state: "prompt" | "granted") {
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn(async () => ({ state })) } });
}

function mic(mode: "ok" | "denied" | "none") {
  permission("prompt");
  if (mode === "none") {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    return;
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => (mode === "ok" ? Promise.resolve({ getTracks: () => [{ stop() {} }] }) : Promise.reject(new DOMException("denied", "NotAllowedError")))),
    },
  });
}

const user = () => userEvent.setup();
const field = () => screen.getByLabelText(/your sentence|what i heard/i) as HTMLTextAreaElement;
const setField = (text: string) => fireEvent.change(field(), { target: { value: text } });
const click = (name: RegExp | string) => user().click(screen.getByRole("button", { name }));
const outcomeOf = () => screen.getAllByTestId("outcome-chip").map((c) => c.getAttribute("data-outcome"));

async function open() {
  render(<GuidedScreen lessonId={LESSON} />);
  await screen.findByTestId("guided-question");
}

async function check(text: string) {
  setField(text);
  await click(/^check$/i);
}

beforeEach(() => {
  resetApp();
  resetGuidedStoreCache();
  router.push.mockClear();
  ai.available = true;
  ai.transcript = "I watched a film yesterday evening.";
  ai.transcribeCalls = 0;
  opinion.next = { status: "ok", opinion: { fit: "fits", confidence: "high", suspected: null } };
  opinion.pending = false;
  opinion.calls = [];
  mic("ok");
});
afterEach(() => vi.unstubAllGlobals());

describe("typed journey: Attempt → Notice → Correct → Understand → Apply", () => {
  it("a good first answer is credited as first try, then the new-situation exercise and the summary", async () => {
    await open();
    expect(screen.getByTestId("guided-question")).toHaveTextContent(/what did you do yesterday evening/i);
    expect(screen.getByText("Step 1 of 5 · Try")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^check$/i })).toBeDisabled(); // nothing to check yet

    await check("I watched a film with my sister.");
    expect(outcomeOf()).toEqual(["first_try"]);
    expect(screen.getByTestId("outcome-card")).toHaveTextContent("That fits.");
    expect(opinion.calls).toHaveLength(0); // on-device check only: no network for the common case

    await click(/^continue$/i);
    expect(screen.getByTestId("transfer-intro")).toHaveTextContent(/one try, plus one nudge/i);
    expect(screen.getByText("Step 5 of 5 · Apply")).toBeInTheDocument();
    await click(/^start$/i);

    // after a first-try success the new situation goes the other way: something unfinished
    expect(screen.getByTestId("guided-question")).toHaveTextContent(/how long have you been learning english/i);
    expect(screen.queryByRole("button", { name: /another hint/i })).not.toBeInTheDocument(); // no hints in transfer
    await check("I have been learning English for three years.");
    expect(outcomeOf()).toEqual(["first_try"]);
    await click(/see my summary/i);

    const summary = screen.getByTestId("summary");
    expect(within(summary).getAllByTestId("outcome-chip").map((c) => c.textContent)).toEqual(["First try", "First try"]);
    expect(screen.getByTestId("how-counted")).toHaveTextContent(/kept separate from your lesson progress/i);
    await click(/back to lesson/i);
    expect(router.push).toHaveBeenCalledWith(`/practice/${LESSON}`);
    expect(getGuidedSnapshot().sessions[0].status).toBe("completed");
    expect(getGuidedSnapshot().activeSessionId).toBeNull();
  });

  it("a mistake gets a calm notice (never error red), keeps the sentence editable, and fixing it is 'fixed it yourself'", async () => {
    await open();
    await check("I have watched a film yesterday evening.");

    const notice = screen.getByTestId("notice-card");
    expect(notice).toHaveTextContent(/take another look/i);
    expect(notice.className).toMatch(/info/);
    expect(notice.className).not.toMatch(/error/);
    expect(screen.getByText("Step 2 of 5 · Notice")).toBeInTheDocument();
    await waitFor(() => expect(field().value).toBe("I have watched a film yesterday evening.")); // their sentence stays for editing
    expect(document.activeElement).toBe(field()); // focus returns to the sentence field after the prompt

    await click(/try again/i); // unchanged: no new attempt, a gentle nudge
    expect(screen.getByTestId("same-note")).toBeInTheDocument();
    expect(screen.queryByTestId("resolved")).not.toBeInTheDocument();

    setField("I watched a film yesterday evening.");
    await click(/try again/i);
    expect(outcomeOf()).toEqual(["self_corrected"]);
    expect(screen.getByTestId("outcome-card")).toHaveTextContent("You spotted it.");
    expect(screen.getByText("Step 3 of 5 · Fix")).toBeInTheDocument();
    await click(/why does this fit/i);
    expect(screen.getByTestId("reason-card")).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 5 · Why")).toBeInTheDocument();
  });

  it("hints come one at a time on request and make the outcome 'fixed with a hint'", async () => {
    await open();
    await check("I have watched a film yesterday evening.");
    expect(screen.queryByTestId("hint-card")).not.toBeInTheDocument();
    await click(/another hint/i);
    expect(screen.getAllByTestId("hint-card")).toHaveLength(1);
    await click(/another hint/i);
    expect(screen.getAllByTestId("hint-card")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /another hint/i })).not.toBeInTheDocument();
    setField("I watched a film yesterday evening.");
    await click(/try again/i);
    expect(outcomeOf()).toEqual(["hint_assisted"]);
  });

  it("three retries lead to 'let's look together'; Show me then needs no retyping", async () => {
    await open();
    await check("I have watched a film yesterday evening.");
    await waitFor(() => expect(field().value).not.toBe(""));
    setField("I have seen a film yesterday evening.");
    await click(/try again/i);
    setField("I have watched two films yesterday evening.");
    await click(/try again/i);
    setField("I have cooked a meal yesterday evening.");
    await click(/try again/i);
    expect(screen.getByTestId("offer-show-me")).toHaveTextContent(/let’s look at it together/i);
    await click(/^show me$/i);
    expect(outcomeOf()).toEqual(["shown"]);
    expect(screen.getByTestId("model-answer").textContent?.length).toBeGreaterThan(5);
    expect(screen.getByTestId("reason-card")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); // nothing to retype
  });

  it("Show me works from the very first screen", async () => {
    await open();
    await click(/^show me$/i);
    expect(outcomeOf()).toEqual(["shown"]);
  });

  it("Enter submits the sentence", async () => {
    await open();
    setField("I watched a film with my sister.");
    await user().type(field(), "{Enter}");
    expect(outcomeOf()).toEqual(["first_try"]);
  });

  it("a refresh in the middle of a correction resumes at the same place", async () => {
    const first = render(<GuidedScreen lessonId={LESSON} />);
    await screen.findByTestId("guided-question");
    await check("I have watched a film yesterday evening.");
    expect(screen.getByTestId("notice-card")).toBeInTheDocument();
    first.unmount();
    resetGuidedStoreCache(); // as after a reload: read back from storage
    await open();
    expect(screen.getByTestId("notice-card")).toBeInTheDocument();
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
  });
});

describe("answers the check cannot judge", () => {
  const UNSURE = "I will go to bed early tonight.";

  it("with no second opinion available: 'can't check this one', nothing counted, and the summary says so", async () => {
    ai.available = false;
    await open();
    expect(screen.getByTestId("voice-off-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speak" })).toBeDisabled();
    await check(UNSURE);
    const cant = screen.getByTestId("cant-check");
    expect(cant).toHaveTextContent(/can’t judge this one for sure/i);
    expect(cant).toHaveTextContent(/not counted/i);
    await click(/mine says the same/i);
    expect(outcomeOf()).toEqual(["unverified"]);
    await click(/^continue$/i);
    await click(/skip for now/i);
    expect(screen.getByTestId("not-counted-note")).toHaveTextContent(/nothing was held against you/i);
    expect(screen.getAllByTestId("outcome-chip")[0]).toHaveTextContent(/not checked · not counted/i);
  });

  it("'I'll change mine' goes back to editing the same sentence", async () => {
    ai.available = false;
    await open();
    await check(UNSURE);
    await click(/i’ll change mine/i);
    await waitFor(() => expect(field().value).toBe(UNSURE));
    setField("I watched a film with my sister.");
    await click(/try again/i);
    // Phase 2 rule: only the FIRST counted answer earns "first try". An earlier unverified answer is
    // never held against the learner, but it does not earn first try either. Flagged for the owner.
    expect(outcomeOf()).toEqual(["self_corrected"]);
  });

  it("an AI second opinion can confirm a fit (and only that)", async () => {
    await open();
    await check(UNSURE);
    await waitFor(() => expect(screen.getByTestId("resolved")).toBeInTheDocument());
    expect(opinion.calls).toEqual([{ itemId: "ppps-main", text: UNSURE, source: "typed" }]);
    expect(outcomeOf()).toEqual(["first_try"]);
  });

  it("the AI saying 'grammar concern' is guidance, not a mistake", async () => {
    opinion.next = { status: "ok", opinion: { fit: "grammar_concern", confidence: "high", suspected: null } };
    await open();
    await check(UNSURE);
    const card = await screen.findByTestId("neutral-card");
    expect(card).toHaveTextContent(/verb tenses/i);
    expect(screen.queryByTestId("retry-dots")).not.toBeInTheDocument(); // not a retry, nothing counted
    expect(screen.queryByTestId("resolved")).not.toBeInTheDocument();
  });

  it("while the AI is checking, typing is never blocked: the check can be skipped and nothing is counted", async () => {
    opinion.pending = true;
    await open();
    await check(UNSURE);
    expect(await screen.findByTestId("checking-card")).toHaveTextContent(/nothing is counted against you/i);
    await click(/skip the check/i);
    expect(screen.getByTestId("cant-check")).toBeInTheDocument();
    await act(async () => opinion.release?.()); // a late answer must change nothing
    expect(screen.getByTestId("cant-check")).toBeInTheDocument();
  });

  it("an AI failure is the same neutral outcome", async () => {
    opinion.next = { status: "failed", reason: "timeout" };
    await open();
    await check(UNSURE);
    expect(await screen.findByTestId("cant-check")).toHaveTextContent(/second opinions aren’t available/i);
  });
});

describe("spoken answers", () => {
  it("record → transcribe → confirm or edit the words → only then is it judged", async () => {
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    expect(screen.getByTestId("mic-explainer")).toHaveTextContent(/recording isn’t kept/i);
    await click(/^continue$/i);

    const stop = await screen.findByRole("button", { name: /stop recording/i });
    await user().click(stop);
    // the words come back for the learner to check; nothing has been judged yet
    expect(await screen.findByRole("heading", { name: /did i hear you right/i })).toBeInTheDocument();
    expect(field().value).toBe("I watched a film yesterday evening.");
    expect(screen.queryByTestId("resolved")).not.toBeInTheDocument();
    expect(ai.transcribeCalls).toBe(1);

    setField("I watched a film last night.");
    await click(/looks right — check it/i);
    expect(outcomeOf()).toEqual(["first_try"]);
    const attempt = getGuidedSnapshot().sessions[0].exercises[0].attempts[0];
    expect(attempt).toMatchObject({ source: "spoken", text: "I watched a film last night." });
    expect(attempt.transcript?.edited).toBe(true);
  });

  it("a wrong spoken sentence can be fixed by voice, and the fix is confirmed too", async () => {
    ai.transcript = "I have watched a film yesterday evening.";
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    await click(/^continue$/i);
    await user().click(await screen.findByRole("button", { name: /stop recording/i }));
    await screen.findByRole("heading", { name: /did i hear you right/i });
    await click(/looks right — check it/i);
    expect(screen.getByTestId("notice-card")).toBeInTheDocument();

    ai.transcript = "I watched a film yesterday evening.";
    await click("Speak");
    await click(/tap to speak/i);
    await user().click(await screen.findByRole("button", { name: /stop recording/i }));
    expect(await screen.findByRole("heading", { name: /did i hear your new sentence/i })).toBeInTheDocument();
    await click(/looks right — check it/i);
    expect(outcomeOf()).toEqual(["self_corrected"]);
  });

  it("an unsure word is flagged at the confirm step and is never treated as a mistake", async () => {
    startGuidedSession({ now: 1, id: "g-unsure" });
    const send = (e: Parameters<typeof dispatchGuided>[1]) => dispatchGuided("g-unsure", e, { aiAvailable: false });
    send({ type: "START_RECORDING" });
    send({ type: "RECORDING_DONE" });
    send({ type: "TRANSCRIPT_READY", text: "I have seen it yesterday evening.", lowConfidenceWords: ["seen"] });
    await open();
    expect(await screen.findByTestId("unsure-words")).toHaveTextContent(/“seen”.*won’t treat it as a mistake until you confirm/i);
    expect(getGuidedSnapshot().sessions[0].exercises[0].attempts).toHaveLength(0);
  });

  it("'Say it again' re-records", async () => {
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    await click(/^continue$/i);
    await user().click(await screen.findByRole("button", { name: /stop recording/i }));
    await screen.findByRole("heading", { name: /did i hear you right/i });
    await click(/say it again/i);
    expect(await screen.findByRole("button", { name: /stop recording/i })).toBeInTheDocument();
  });

  it("a blocked microphone explains what to do, counts nothing, and typing carries on", async () => {
    mic("denied");
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    await click(/^continue$/i);
    expect(await screen.findByTestId("voice-message")).toHaveTextContent(/microphone is off/i);
    expect(screen.getByTestId("mic-help")).toHaveTextContent(/site settings/i);
    expect(getGuidedSnapshot().sessions[0].exercises[0].attempts).toHaveLength(0);
    await check("I watched a film with my sister.");
    expect(outcomeOf()).toEqual(["first_try"]);
  });

  it("transcription failure is neutral: nothing counted, typing is one tap away", async () => {
    ai.transcript = null;
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    await click(/^continue$/i);
    await user().click(await screen.findByRole("button", { name: /stop recording/i }));
    expect(await screen.findByTestId("voice-message")).toHaveTextContent(/that’s not on you/i);
    expect(getGuidedSnapshot().sessions[0].exercises[0].attempts).toHaveLength(0);
    expect(screen.getByRole("button", { name: /try speaking again/i })).toBeInTheDocument();
    await check("I watched a film with my sister.");
    expect(outcomeOf()).toEqual(["first_try"]);
  });

  it("when the browser has already granted the microphone the explainer is skipped", async () => {
    permission("granted");
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    expect(screen.queryByTestId("mic-explainer")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /stop recording/i })).toBeInTheDocument();
  });

  it("a browser that cannot record offers typing and nothing else changes", async () => {
    mic("none");
    await open();
    expect(screen.getByRole("button", { name: "Speak" })).toBeDisabled();
    await check("I watched a film with my sister.");
    expect(outcomeOf()).toEqual(["first_try"]);
  });

  it("cancelling a recording goes back to where the learner was", async () => {
    await open();
    await click("Speak");
    await click(/tap to speak/i);
    await click(/^continue$/i);
    await screen.findByRole("button", { name: /stop recording/i });
    await click(/^cancel$/i);
    expect(screen.getByTestId("mic-ready")).toBeInTheDocument();
    expect(getGuidedSnapshot().sessions[0].exercises[0].attempts).toHaveLength(0);
  });
});

describe("accessibility", () => {
  it("announces Migo's prompts in a polite live region and labels every control", async () => {
    await open();
    const live = screen.getByTestId("guided-announcer");
    expect(live).toHaveAttribute("aria-live", "polite");
    await check("I have watched a film yesterday evening.");
    await waitFor(() => expect(live.textContent).toMatch(/take another look|verb|yesterday/i));
    expect(screen.getByRole("progressbar", { name: /fix it with migo progress/i })).toHaveAttribute("aria-valuetext", "Step 2 of 5 · Notice");
    for (const b of screen.getAllByRole("button")) expect(b, b.outerHTML).toHaveAccessibleName();
    expect(screen.getByRole("group", { name: /how do you want to answer/i })).toBeInTheDocument();
  });

  it("leaving asks first and keeps the place", async () => {
    await open();
    await click(/leave fix it with migo/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(/your place is saved/i);
    await click(/save & exit/i);
    expect(router.push).toHaveBeenCalledWith(`/practice/${LESSON}`);
    expect(getGuidedSnapshot().activeSessionId).not.toBeNull();
  });
});

describe("entry points", () => {
  it("the lesson introduction offers Fix it with Migo for this lesson only", async () => {
    const { unmount } = render(<IntroScreen lessonId={LESSON} />);
    const card = await screen.findByTestId("guided-entry");
    expect(card).toHaveTextContent(/separate from lesson progress/i);
    expect(within(card).getByRole("link", { name: /fix it with migo/i })).toHaveAttribute("href", `/practice/${LESSON}/guided`);
    unmount();
    render(<IntroScreen lessonId="a1-be-present" />);
    await screen.findByRole("button", { name: /start lesson/i });
    expect(screen.queryByTestId("guided-entry")).not.toBeInTheDocument();
  });
});
