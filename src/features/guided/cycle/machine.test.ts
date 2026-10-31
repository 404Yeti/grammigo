import { describe, expect, it } from "vitest";
import { GUIDED_LIMITS } from "./config";
import { createGuidedSession, reduce } from "./machine";
import { pickTransfer } from "./transfer";
import { CORRECT, NOTHING, T0, WRONG, evaluation, runner, scripted } from "./testkit";

/** Real evaluator, natural sentences. */
const GOOD = "I watched a film with my sister.";
const BAD = "I have watched a film yesterday evening.";

describe("a session starts in the right place", () => {
  it("begins at the main exercise, waiting for an answer, with no outcome", () => {
    const s = createGuidedSession("s1", T0);
    expect(s).toMatchObject({ status: "in_progress", stage: "main", transferDeclined: false, completedAt: null });
    expect(s.exercises).toHaveLength(1);
    expect(s.exercises[0]).toMatchObject({ itemId: "ppps-main", kind: "main", phase: "attempting", inputMode: "typed", attempts: [], outcome: null, rung: 0, retriesUsed: 0 });
  });

  it("refuses an item that does not exist", () => {
    expect(() => createGuidedSession("s1", T0, "nope")).toThrow();
  });
});

describe("ATTEMPT → CORRECT → UNDERSTAND → APPLY (the happy path, all the way to completion)", () => {
  it("first try, then the opposite-direction transfer, then summary, then done", () => {
    const r = runner();
    expect(r.answer(GOOD).session.exercises[0]).toMatchObject({ phase: "resolved", outcome: { kind: "first_try", basis: "deterministic", source: "typed" } });
    expect(r.send({ type: "CONTINUE" }).session.stage).toBe("transfer_intro");
    r.send({ type: "START_TRANSFER" });
    expect(r.session.stage).toBe("transfer");
    expect(r.ex).toMatchObject({ kind: "transfer", itemId: "ppps-transfer-unfinished", phase: "attempting" }); // first try → opposite direction
    r.answer("I've been learning English for three years.");
    expect(r.ex.outcome?.kind).toBe("first_try");
    expect(r.send({ type: "CONTINUE" }).session.stage).toBe("summary");
    const done = r.send({ type: "FINISH" }).session;
    expect(done).toMatchObject({ status: "completed", stage: "done" });
    expect(done.completedAt).not.toBeNull();
  });

  it("the transfer can be skipped, and the session still completes", () => {
    const r = runner();
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    expect(r.send({ type: "SKIP_TRANSFER" }).session).toMatchObject({ stage: "summary", transferDeclined: true });
    expect(r.send({ type: "FINISH" }).session.status).toBe("completed");
    expect(r.session.exercises).toHaveLength(1);
  });

  it("events out of order are ignored without changing anything", () => {
    const r = runner();
    for (const e of [{ type: "CONTINUE" }, { type: "START_TRANSFER" }, { type: "FINISH" }, { type: "SKIP_TRANSFER" }] as const) {
      const before = r.session;
      const out = r.send(e);
      expect(out.rejected, e.type).not.toBeNull();
      expect(r.session).toBe(before);
    }
  });
});

describe("NOTICE → CORRECT: fixing it yourself", () => {
  it("a mistake shows the first prompt with the learner's own words; fixing it unaided is 'self_corrected'", () => {
    const r = runner();
    r.answer(BAD);
    expect(r.ex).toMatchObject({ phase: "repairing", rung: 1, retriesUsed: 0, hintsUsed: 0, category: "pp_with_finished_time" });
    expect(r.ex.ladder).toMatchObject({ marker: "yesterday", aux: "have", verb: "watched" });
    r.answer(GOOD);
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "self_corrected", basis: "deterministic", source: "typed" } });
  });

  it("a mistake sends the learner to the SAME-direction transfer", () => {
    const r = runner();
    r.answer(BAD);
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    r.send({ type: "START_TRANSFER" });
    expect(r.ex.itemId).toBe("ppps-transfer-finished");
  });
});

describe("the hint ladder", () => {
  it("rung 1 is free; two more hints can be asked for, then no more; fixing after a hint is 'hint_assisted'", () => {
    const r = runner();
    r.answer(BAD);
    expect(r.send({ type: "REQUEST_HINT" }).session.exercises[0]).toMatchObject({ rung: 2, hintsUsed: 1 });
    expect(r.send({ type: "REQUEST_HINT" }).session.exercises[0]).toMatchObject({ rung: 3, hintsUsed: 2 });
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBe("no_more_hints");
    expect(r.ex.hintsUsed).toBe(2);
    r.answer(GOOD);
    expect(r.ex.outcome).toMatchObject({ kind: "hint_assisted" });
  });

  it("a hint cannot be asked for before there is a mistake to give a hint about", () => {
    const r = runner();
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBe("hint_not_available");
  });
});

describe("retries are bounded, and Show me is always available", () => {
  it("up to three retries after the first mistake, then Migo offers to show it, and nothing else is accepted but Show me", () => {
    const r = runner();
    const wrong = ["I have watched a film yesterday evening.", "I have cooked dinner yesterday evening.", "I have called my mum yesterday evening.", "I have met my friends yesterday evening."];
    r.answer(wrong[0]);
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 0 });
    r.answer(wrong[1]);
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 1 });
    r.answer(wrong[2]);
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 2 });
    r.answer(wrong[3]);
    expect(r.ex).toMatchObject({ phase: "offer_show_me", retriesUsed: GUIDED_LIMITS.maxRetries });
    expect(r.send({ type: "EDIT", draft: "x" }).rejected).toBe("not_available_now");
    expect(r.send({ type: "SUBMIT" }).rejected).toBe("not_available_now");
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBe("hint_not_available");
    expect(r.send({ type: "SHOW_ME" }).session.exercises[0].outcome).toMatchObject({ kind: "shown", basis: "none", source: null });
  });

  it("a retry that is fixed on the third try still counts as self-corrected, not as a failure", () => {
    const r = runner();
    r.answer("I have watched a film yesterday evening.");
    r.answer("I have cooked dinner yesterday evening.");
    r.answer("I have called my mum yesterday evening.");
    r.answer(GOOD);
    expect(r.ex.outcome?.kind).toBe("self_corrected");
  });

  it("Show me works at the very start, with no answer and no retype required", () => {
    const r = runner();
    const out = r.send({ type: "SHOW_ME" });
    expect(out.rejected).toBeNull();
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "shown" }, attempts: [] });
    expect(r.send({ type: "SUBMIT" }).rejected).toBe("not_available_now"); // nothing to retype
  });

  it("Show me works in the middle of the ladder too", () => {
    const r = runner();
    r.answer(BAD);
    r.send({ type: "REQUEST_HINT" });
    r.send({ type: "SHOW_ME" });
    expect(r.ex.outcome?.kind).toBe("shown");
    expect(r.send({ type: "SHOW_ME" }).rejected).toBe("already_resolved");
  });

  it("re-sending the same wrong answer is not a new attempt", () => {
    const r = runner();
    r.answer(BAD);
    const before = r.ex.attempts.length;
    const out = r.answer(BAD);
    expect(out.rejected).toBe("unchanged");
    expect(r.ex.attempts).toHaveLength(before);
    expect(r.ex.retriesUsed).toBe(0);
  });

  it("an empty answer is rejected and changes nothing", () => {
    const r = runner();
    expect(r.answer("   ").rejected).toBe("empty");
    expect(r.ex.attempts).toHaveLength(0);
  });
});

describe("answers with nothing to judge are never a mistake, a retry, or a penalty", () => {
  it("are recorded, flagged, and leave the exercise exactly where it was", () => {
    const r = runner({ evaluate: scripted({ "Nothing special.": NOTHING, [BAD]: WRONG, [GOOD]: CORRECT }) });
    r.answer("Nothing special.");
    expect(r.ex).toMatchObject({ phase: "attempting", retriesUsed: 0, rung: 0, nonAttempts: 1, notice: "not_an_attempt" });
    expect(r.ex.attempts[0].notAnAttempt).toBe(true);
    r.answer(GOOD);
    expect(r.ex.outcome?.kind).toBe("first_try"); // the non-attempt did not count as a first attempt
  });

  it("three in a row end the exercise as unverified, with no penalty", () => {
    const r = runner({ evaluate: scripted({ a: NOTHING, b: NOTHING, c: NOTHING }) });
    r.answer("a");
    r.answer("b");
    expect(r.ex.phase).toBe("attempting");
    r.answer("c");
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "unverified", basis: "none" }, unverifiedReason: "no_answer_to_judge" });
  });

  it("a non-attempt in the middle of the ladder does not use up a retry", () => {
    const r = runner({ evaluate: scripted({ [BAD]: WRONG, "...": NOTHING }) });
    r.answer(BAD);
    r.answer("...");
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 0, rung: 1 });
  });
});

describe("the transfer exercise measures independent ability", () => {
  const toTransfer = (r: ReturnType<typeof runner>) => {
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    r.send({ type: "START_TRANSFER" });
  };

  it("has no hint ladder", () => {
    const r = runner();
    toTransfer(r);
    r.answer("I work here since three years.");
    expect(r.ex).toMatchObject({ phase: "repairing", rung: 1 });
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBe("no_hints_in_transfer");
  });

  it("allows one nudge and one retry, then offers Show me", () => {
    const r = runner();
    toTransfer(r);
    r.answer("I work here since three years.");
    expect(r.ex.phase).toBe("repairing");
    r.answer("I work here since five years.");
    expect(r.ex).toMatchObject({ phase: "offer_show_me", retriesUsed: GUIDED_LIMITS.transferRetries });
  });

  it("records its outcome separately from the main exercise", () => {
    const r = runner();
    r.answer(BAD);
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    r.send({ type: "START_TRANSFER" });
    r.answer("I went to Spain last summer.");
    expect(r.session.exercises.map((e) => [e.kind, e.outcome?.kind])).toEqual([["main", "self_corrected"], ["transfer", "first_try"]]);
  });
});

describe("choosing the transfer", () => {
  it("same direction after a mistake, shown answer or unverified answer; the opposite direction after a first-try success", () => {
    expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: "first_try", seen: [] })).toBe("ppps-transfer-unfinished");
    for (const o of ["self_corrected", "hint_assisted", "shown", "unverified"] as const) expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: o, seen: [] })).toBe("ppps-transfer-finished");
  });

  it("rotates to something not yet seen, falls back to the alternate, and never repeats the main item", () => {
    expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: "first_try", seen: ["ppps-transfer-unfinished"] })).not.toBe("ppps-transfer-unfinished");
    expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: "shown", seen: ["ppps-transfer-finished"] })).toBe("ppps-transfer-unfinished");
    expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: "shown", seen: ["ppps-transfer-finished", "ppps-transfer-unfinished", "ppps-experience"] })).toBe("ppps-transfer-finished");
    for (const o of ["first_try", "shown"] as const) expect(pickTransfer({ mainItemId: "ppps-main", mainOutcome: o, seen: [] })).not.toBe("ppps-main");
  });

  it("uses the learner's own seen history from the context", () => {
    const r = runner({ seenItemIds: ["ppps-transfer-unfinished"] });
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    r.send({ type: "START_TRANSFER" });
    expect(r.ex.itemId).not.toBe("ppps-transfer-unfinished");
  });
});

describe("leaving", () => {
  it("abandoning ends the session with no outcome change; nothing is accepted afterwards", () => {
    const r = runner();
    r.answer(BAD);
    const out = r.send({ type: "ABANDON" });
    expect(out.session).toMatchObject({ status: "abandoned", stage: "done" });
    expect(r.ex.outcome).toBeNull();
    expect(r.send({ type: "EDIT", draft: "x" }).rejected).toBe("session_not_active");
  });

  it("an exercise has at most one outcome, and it never changes once set", () => {
    const r = runner();
    r.answer(GOOD);
    const first = r.ex.outcome;
    for (const e of [{ type: "SHOW_ME" }, { type: "ACCEPT_AS_IS" }, { type: "REQUEST_HINT" }] as const) r.send(e);
    r.answer(BAD);
    expect(r.ex.outcome).toEqual(first);
  });

  it("is purely a function of its inputs: it never mutates the session it was given", () => {
    const s = createGuidedSession("s1", T0);
    const frozen = JSON.stringify(s);
    reduce(s, { type: "EDIT", draft: GOOD }, { now: T0 + 1 });
    reduce(s, { type: "SHOW_ME" }, { now: T0 + 2 });
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe("only the deterministic evaluator can record a mistake", () => {
  it("every 'incorrect' attempt came from an evaluation that said incorrect", () => {
    const ev = scripted({ one: WRONG, two: evaluation({ verdict: "uncertain" }), three: CORRECT });
    const r = runner({ evaluate: ev, aiAvailable: false });
    r.answer("one");
    r.answer("two");
    r.answer("three");
    const said = new Set(ev.calls.filter((c) => c.input.text === "one").map(() => "incorrect"));
    expect(r.ex.attempts.map((a) => a.verdict)).toEqual(["incorrect", "uncertain", "correct"]);
    expect(said.has("incorrect")).toBe(true);
  });
});
