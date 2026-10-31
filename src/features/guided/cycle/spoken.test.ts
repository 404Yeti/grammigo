import { describe, expect, it } from "vitest";
import { createGuidedSession } from "./machine";
import { VOICE_MESSAGES } from "./messages";
import { CORRECT, WRONG, runner, scripted } from "./testkit";
import type { VoiceIssue } from "@/types/guided";

const GOOD = "I watched a film with my sister.";
const BAD = "I have watched a film yesterday evening.";

const toConfirm = (r: ReturnType<typeof runner>, text = GOOD, low: string[] = []) => {
  r.send({ type: "START_RECORDING" });
  r.send({ type: "RECORDING_DONE" });
  r.send({ type: "TRANSCRIPT_READY", text, lowConfidenceWords: low });
};

describe("spoken answers: record → transcribe → CONFIRM → evaluate", () => {
  it("walks the pipeline in order and does not evaluate anything until the learner confirms", () => {
    const ev = scripted({ [GOOD]: CORRECT });
    const r = runner({ evaluate: ev });
    r.send({ type: "START_RECORDING" });
    expect(r.ex).toMatchObject({ phase: "recording", returnPhase: "attempting", inputMode: "spoken" });
    r.send({ type: "RECORDING_DONE" });
    expect(r.ex.phase).toBe("transcribing");
    r.send({ type: "TRANSCRIPT_READY", text: GOOD });
    expect(r.ex).toMatchObject({ phase: "confirming", draft: GOOD, pendingTranscript: { raw: GOOD, edited: false } });
    expect(ev.calls).toHaveLength(0); // nothing has been judged
    expect(r.ex.attempts).toHaveLength(0);
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(ev.calls).toHaveLength(1);
    expect(ev.calls[0].input).toEqual({ text: GOOD, source: "spoken" });
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "first_try", source: "spoken" } });
    expect(r.ex.attempts[0].transcript).toEqual({ raw: GOOD, edited: false, lowConfidenceWords: [] });
  });

  it("judges the text the learner CONFIRMED, including their edits, and records that it was edited", () => {
    const ev = scripted({ "I watched a film.": CORRECT });
    const r = runner({ evaluate: ev });
    toConfirm(r, "I have watch a film.");
    r.send({ type: "EDIT_TRANSCRIPT", text: "I watched a film." });
    expect(r.ex.pendingTranscript).toMatchObject({ raw: "I have watch a film.", edited: true });
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(ev.calls.map((c) => c.input.text)).toEqual(["I watched a film."]);
    expect(r.ex.attempts[0].transcript).toMatchObject({ raw: "I have watch a film.", edited: true });
  });

  it("changing it back to what was heard clears the 'edited' flag", () => {
    const r = runner();
    toConfirm(r, "I went out.");
    r.send({ type: "EDIT_TRANSCRIPT", text: "I went outside." });
    expect(r.ex.pendingTranscript?.edited).toBe(true);
    r.send({ type: "EDIT_TRANSCRIPT", text: "I went out." });
    expect(r.ex.pendingTranscript?.edited).toBe(false);
  });

  it("words the transcriber was unsure of are kept for the learner to check, and never change the verdict", () => {
    const ev = scripted({ [GOOD]: CORRECT });
    const r = runner({ evaluate: ev });
    toConfirm(r, GOOD, ["watched", "sister"]);
    expect(r.ex.pendingTranscript?.lowConfidenceWords).toEqual(["watched", "sister"]);
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(r.ex.outcome?.kind).toBe("first_try");
    expect(r.ex.attempts[0].transcript?.lowConfidenceWords).toEqual(["watched", "sister"]);
  });

  it("an empty confirmation is refused and the learner stays at the confirm step", () => {
    const r = runner();
    toConfirm(r);
    r.send({ type: "EDIT_TRANSCRIPT", text: "   " });
    expect(r.send({ type: "CONFIRM_TRANSCRIPT" }).rejected).toBe("empty_transcript");
    expect(r.ex.phase).toBe("confirming");
    expect(r.ex.attempts).toHaveLength(0);
  });

  it("a spoken answer is judged by the same rules as a typed one (real evaluator)", () => {
    const typed = runner();
    typed.answer(BAD);
    const spoken = runner();
    toConfirm(spoken, BAD);
    spoken.send({ type: "CONFIRM_TRANSCRIPT" });
    expect({ ...spoken.ex.attempts[0], source: "typed", transcript: null, at: 0 }).toEqual({ ...typed.ex.attempts[0], at: 0 });
    expect(spoken.ex.category).toBe(typed.ex.category);
    expect(spoken.ex.phase).toBe(typed.ex.phase);
  });
});

describe("correction by voice", () => {
  it("fixing the sentence by voice goes through the same confirm step and counts like any fix", () => {
    const r = runner();
    r.answer(BAD);
    expect(r.ex).toMatchObject({ phase: "repairing", rung: 1 });
    r.send({ type: "START_RECORDING" });
    expect(r.ex.returnPhase).toBe("repairing");
    r.send({ type: "RECORDING_DONE" });
    r.send({ type: "TRANSCRIPT_READY", text: GOOD });
    expect(r.ex.attempts).toHaveLength(1); // not judged yet
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "self_corrected", source: "spoken" } });
  });

  it("a spoken correction that is still wrong uses a retry, like a typed one", () => {
    const r = runner();
    r.answer(BAD);
    toConfirm(r, "I have cooked dinner yesterday evening.");
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 1 });
  });

  it("hints stay available while correcting by voice", () => {
    const r = runner();
    r.answer(BAD);
    r.send({ type: "START_RECORDING" });
    r.send({ type: "CANCEL_RECORDING" });
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBeNull();
    expect(r.ex.rung).toBe(2);
  });
});

describe("recording, cancelling and redoing", () => {
  it("cancelling from any step of the pipeline returns to where the learner was, with no attempt", () => {
    for (const upTo of ["recording", "transcribing", "confirming"] as const) {
      const r = runner();
      r.send({ type: "START_RECORDING" });
      if (upTo !== "recording") r.send({ type: "RECORDING_DONE" });
      if (upTo === "confirming") r.send({ type: "TRANSCRIPT_READY", text: GOOD });
      r.send({ type: "CANCEL_RECORDING" });
      expect(r.ex, upTo).toMatchObject({ phase: "attempting", pendingTranscript: null, attempts: [] });
    }
  });

  it("'say it again' discards the transcript and records again", () => {
    const r = runner();
    toConfirm(r);
    r.send({ type: "REDO_RECORDING" });
    expect(r.ex).toMatchObject({ phase: "recording", pendingTranscript: null, draft: "" });
  });

  it("pipeline events are ignored when they do not belong to the current step", () => {
    const r = runner();
    expect(r.send({ type: "RECORDING_DONE" }).rejected).toBe("not_recording");
    expect(r.send({ type: "TRANSCRIPT_READY", text: "x" }).rejected).toBe("not_transcribing");
    expect(r.send({ type: "CONFIRM_TRANSCRIPT" }).rejected).toBe("not_confirming");
    expect(r.send({ type: "EDIT_TRANSCRIPT", text: "x" }).rejected).toBe("not_confirming");
    expect(r.send({ type: "REDO_RECORDING" }).rejected).toBe("not_confirming");
    expect(r.send({ type: "CANCEL_RECORDING" }).rejected).toBe("not_recording");
  });
});

describe("when voice fails, typing always works and nothing is counted", () => {
  const ISSUES: VoiceIssue[] = ["permission_denied", "unsupported", "no_speech", "failed", "timeout", "offline"];

  it("every failure returns to the same place, in typed mode, with no attempt, retry or penalty", () => {
    for (const issue of ISSUES) {
      const r = runner();
      r.answer(BAD); // now repairing with one mistake on record
      const before = r.ex;
      r.send({ type: "START_RECORDING" });
      r.send({ type: "TRANSCRIPT_FAILED", reason: issue });
      expect(r.ex, issue).toMatchObject({ phase: "repairing", inputMode: "typed", voiceIssue: issue, retriesUsed: before.retriesUsed, rung: before.rung, hintsUsed: before.hintsUsed, pendingTranscript: null });
      expect(r.ex.attempts, issue).toHaveLength(before.attempts.length);
      // and the learner simply types the fix
      r.answer(GOOD);
      expect(r.ex.outcome, issue).toMatchObject({ kind: "self_corrected", source: "typed" });
    }
  });

  it("a failure while transcribing behaves the same as one while recording", () => {
    const r = runner();
    r.send({ type: "START_RECORDING" });
    r.send({ type: "RECORDING_DONE" });
    r.send({ type: "TRANSCRIPT_FAILED", reason: "failed" });
    expect(r.ex).toMatchObject({ phase: "attempting", voiceIssue: "failed", inputMode: "typed" });
  });

  it("silence is a voice problem, not an answer: an empty transcript becomes 'no speech'", () => {
    const r = runner();
    r.send({ type: "START_RECORDING" });
    r.send({ type: "RECORDING_DONE" });
    r.send({ type: "TRANSCRIPT_READY", text: "   " });
    expect(r.ex).toMatchObject({ phase: "attempting", voiceIssue: "no_speech", attempts: [] });
  });

  it("a denied microphone can be tried again (the learner may have changed the setting); an unsupported browser cannot", () => {
    const denied = runner();
    denied.send({ type: "START_RECORDING" });
    denied.send({ type: "TRANSCRIPT_FAILED", reason: "permission_denied" });
    expect(denied.send({ type: "START_RECORDING" }).rejected).toBeNull();
    expect(denied.ex.voiceIssue).toBeNull();

    const unsupported = runner();
    unsupported.send({ type: "START_RECORDING" });
    unsupported.send({ type: "TRANSCRIPT_FAILED", reason: "unsupported" });
    expect(unsupported.send({ type: "START_RECORDING" }).rejected).toBe("voice_unavailable");
    expect(unsupported.send({ type: "SET_MODE", mode: "spoken" }).rejected).toBe("voice_unavailable");
    expect(unsupported.answer(GOOD).session.exercises[0].outcome?.kind).toBe("first_try");
  });

  it("every failure has a plain-language message that does not blame the learner", () => {
    for (const issue of ISSUES) expect(VOICE_MESSAGES[issue], issue).not.toMatch(/you (failed|did it wrong)|your fault|wrong|mistake/i);
    const r = runner();
    r.send({ type: "START_RECORDING" });
    r.send({ type: "TRANSCRIPT_FAILED", reason: "permission_denied" });
  });
});

describe("switching between typing and speaking never loses the learner's place", () => {
  it("typing instead, from the confirm step, keeps the words and drops the recording", () => {
    const r = runner();
    toConfirm(r, "I went out last night.");
    r.send({ type: "SET_MODE", mode: "typed" });
    expect(r.ex).toMatchObject({ phase: "attempting", inputMode: "typed", pendingTranscript: null, draft: "I went out last night." });
    expect(r.ex.attempts).toHaveLength(0);
  });

  it("the mode can be switched in any interactive step", () => {
    const r = runner();
    r.send({ type: "SET_MODE", mode: "spoken" });
    expect(r.ex.inputMode).toBe("spoken");
    r.send({ type: "SET_MODE", mode: "typed" });
    expect(r.ex.inputMode).toBe("typed");
    r.answer(BAD);
    expect(r.send({ type: "SET_MODE", mode: "spoken" }).rejected).toBeNull();
  });

  it("Show me works at every step of the voice pipeline and discards the transcript", () => {
    for (const upTo of ["recording", "transcribing", "confirming"] as const) {
      const r = runner();
      r.send({ type: "START_RECORDING" });
      if (upTo !== "recording") r.send({ type: "RECORDING_DONE" });
      if (upTo === "confirming") r.send({ type: "TRANSCRIPT_READY", text: GOOD });
      r.send({ type: "SHOW_ME" });
      expect(r.ex, upTo).toMatchObject({ phase: "resolved", pendingTranscript: null, outcome: { kind: "shown" } });
    }
  });

  it("a session can be created, and voice events still obey a finished session", () => {
    const s = createGuidedSession("x", 1);
    expect(s.exercises[0].inputMode).toBe("typed");
  });
});

describe("spoken and typed evidence is distinguishable", () => {
  it("each attempt records how it was given", () => {
    const r = runner({ evaluate: scripted({ [BAD]: WRONG, [GOOD]: CORRECT }) });
    r.answer(BAD);
    toConfirm(r, GOOD);
    r.send({ type: "CONFIRM_TRANSCRIPT" });
    expect(r.ex.attempts.map((a) => a.source)).toEqual(["typed", "spoken"]);
    expect(r.ex.attempts[0].transcript).toBeNull();
    expect(r.ex.attempts[1].transcript).not.toBeNull();
  });
});
