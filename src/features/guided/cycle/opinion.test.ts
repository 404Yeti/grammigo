import { describe, expect, it } from "vitest";
import type { OpinionConfidence, OpinionFit } from "@/types/guided";
import { GUIDED_LIMITS } from "./config";
import { decideOnOpinion, parseOpinion, type OpinionResult } from "./opinion";
import { CORRECT, WRONG, runner, scripted } from "./testkit";
import { viewExercise, NEUTRAL } from "./messages";

const UNSURE_TEXT = "I have watched a film."; // real evaluator: uncertain (a present perfect with no time word)
const GOOD = "I watched a film with my sister.";
const BAD = "I have watched a film yesterday evening.";

const ok = (fit: OpinionFit, confidence: OpinionConfidence, suspected: "pp_with_finished_time" | null = null): OpinionResult => ({ status: "ok", opinion: { fit, confidence, suspected } });

describe("an uncertain answer asks for a bounded second opinion", () => {
  it("moves to 'checking' and returns an effect describing exactly what to ask; the answer is NOT marked wrong", () => {
    const r = runner();
    const out = r.answer(UNSURE_TEXT);
    expect(r.ex).toMatchObject({ phase: "checking_opinion", opinionsUsed: 1 });
    expect(out.effects).toEqual([{ type: "request_opinion", exerciseId: "s1:main", itemId: "ppps-main", text: UNSURE_TEXT, source: "typed" }]);
    expect(r.ex.attempts[0]).toMatchObject({ verdict: "uncertain", category: null });
    expect(r.ex.retriesUsed).toBe(0);
    expect(r.ex.outcome).toBeNull();
  });

  it("while waiting, nothing else can be submitted, but Show me and skipping always work", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    expect(r.send({ type: "SUBMIT" }).rejected).toBe("not_available_now");
    expect(r.send({ type: "REQUEST_HINT" }).rejected).toBe("hint_not_available");
    expect(r.send({ type: "SKIP_OPINION" }).rejected).toBeNull();
    expect(r.ex).toMatchObject({ phase: "unverified", unverifiedReason: "opinion_skipped" });
  });

  it("Show me works while the opinion is pending", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "SHOW_ME" });
    expect(r.ex.outcome?.kind).toBe("shown");
  });

  it("with AI unavailable the learner goes straight to the neutral path: no effect, no penalty", () => {
    const r = runner({ aiAvailable: false });
    const out = r.answer(UNSURE_TEXT);
    expect(out.effects).toEqual([]);
    expect(r.ex).toMatchObject({ phase: "unverified", unverifiedReason: "second_opinion_unavailable", retriesUsed: 0, outcome: null });
    expect(viewExercise(r.ex).neutral).toContain(NEUTRAL.unverifiedNoSecondOpinion);
  });

  it("is bounded: at most two opinions per exercise, then uncertain answers are simply left unjudged", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "OPINION", result: ok("unclear", "high") });
    r.answer("I have cooked dinner.");
    expect(r.ex.opinionsUsed).toBe(2);
    r.send({ type: "OPINION", result: ok("unclear", "high") });
    const out = r.answer("I have called my mum.");
    expect(out.effects).toEqual([]);
    expect(r.ex).toMatchObject({ phase: "unverified", unverifiedReason: "no_more_opinions", opinionsUsed: GUIDED_LIMITS.maxOpinions });
  });
});

describe("what the AI is allowed to conclude", () => {
  it("'fits' with HIGH confidence confirms a success, labelled as AI-confirmed", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "OPINION", result: ok("fits", "high") });
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "first_try", basis: "ai_second_opinion", source: "typed" } });
    expect(r.ex.attempts[0].opinion).toEqual({ fit: "fits", confidence: "high", suspected: null });
  });

  it("'fits' with less than high confidence is not enough to confirm anything", () => {
    for (const c of ["low", "medium"] as const) {
      const r = runner();
      r.answer(UNSURE_TEXT);
      r.send({ type: "OPINION", result: ok("fits", c) });
      expect(r.ex, c).toMatchObject({ phase: "unverified", outcome: null });
    }
  });

  it("'incomplete' and 'off_prompt' lead to an ungraded clarification, not to a mistake", () => {
    for (const fit of ["incomplete", "off_prompt"] as const) {
      const r = runner();
      r.answer(UNSURE_TEXT);
      r.send({ type: "OPINION", result: ok(fit, "medium") });
      expect(r.ex, fit).toMatchObject({ phase: "clarifying", clarify: { kind: fit }, clarificationsUsed: 1, retriesUsed: 0, outcome: null });
      expect(r.ex.attempts[0].verdict, fit).toBe("uncertain");
      expect(viewExercise(r.ex).neutral, fit).toBe(NEUTRAL.clarify[fit]);
    }
  });

  it("a 'grammar_concern' is guidance only: it can NEVER make the answer incorrect, at any confidence", () => {
    for (const c of ["low", "medium", "high"] as const) {
      const r = runner();
      r.answer(UNSURE_TEXT);
      r.send({ type: "OPINION", result: ok("grammar_concern", c, "pp_with_finished_time") });
      expect(r.ex.attempts.every((a) => a.verdict !== "incorrect"), c).toBe(true);
      expect(r.ex.retriesUsed, c).toBe(0);
      expect(r.ex.rung, c).toBe(0); // no ladder: nothing was established
      expect(r.ex.category, c).toBeNull();
      expect(r.ex.outcome?.kind ?? "none", c).not.toBe("shown");
    }
  });

  it("a high-confidence grammar concern offers the optional, ungraded clarification, using the authored wording for the suspected type", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "OPINION", result: ok("grammar_concern", "high", "pp_with_finished_time") });
    expect(r.ex).toMatchObject({ phase: "clarifying", clarify: { kind: "grammar_guidance", suspected: "pp_with_finished_time" } });
    expect(viewExercise(r.ex).neutral).toContain("Does the verb fit?");
  });

  it("an AI-suggested type that this item does not teach is ignored (feedback stays on the target skill)", () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "OPINION", result: ok("grammar_concern", "high", null) });
    expect(r.ex.clarify).toEqual({ kind: "grammar_guidance", suspected: null });
    expect(viewExercise(r.ex).neutral).toBe(NEUTRAL.clarify.grammar_guidance);
    // the transfer item for 'since/for' does not accept a made-up suspected type on a finished-time item
    expect(decideOnOpinion({ fit: "grammar_concern", confidence: "high", suspected: "since_for_confusion" }, { clarificationsUsed: 0, itemCategories: ["pp_with_finished_time", "participle_form"] })).toEqual({ action: "clarify", kind: "grammar_guidance", suspected: null });
  });

  it("'unclear', and low-confidence opinions of any kind, leave the answer unverified", () => {
    for (const result of [ok("unclear", "high"), ok("incomplete", "low"), ok("off_prompt", "low"), ok("grammar_concern", "low")]) {
      const r = runner();
      r.answer(UNSURE_TEXT);
      r.send({ type: "OPINION", result });
      expect(r.ex.phase).toBe("unverified");
      expect(r.ex.outcome).toBeNull();
    }
  });
});

describe("after an ungraded clarification", () => {
  const toClarify = () => {
    const r = runner();
    r.answer(UNSURE_TEXT);
    r.send({ type: "OPINION", result: ok("grammar_concern", "high") });
    return r;
  };

  it("a better answer is credited as fixed after a neutral prompt (self-corrected)", () => {
    const r = toClarify();
    r.answer(GOOD);
    expect(r.ex.outcome).toMatchObject({ kind: "self_corrected", basis: "deterministic" });
  });

  it("an answer that is then clearly a target mistake enters the normal ladder with every retry still available", () => {
    const r = toClarify();
    r.answer(BAD);
    expect(r.ex).toMatchObject({ phase: "repairing", retriesUsed: 0, rung: 1, category: "pp_with_finished_time", clarify: null });
  });

  it("the learner can decline with 'mine says the same': unverified, no penalty", () => {
    const r = toClarify();
    r.send({ type: "ACCEPT_AS_IS" });
    expect(r.ex).toMatchObject({ phase: "resolved", outcome: { kind: "unverified", basis: "none", source: null } });
  });

  it("only one clarification is offered per exercise", () => {
    const r = toClarify();
    r.answer("I have cooked dinner.");
    r.send({ type: "OPINION", result: ok("grammar_concern", "high") });
    expect(r.ex).toMatchObject({ phase: "unverified", unverifiedReason: "opinion_clarification_used", clarificationsUsed: 1 });
  });

  it("an unverified answer is never turned into a failure: the learner can retry, move on, or see the answer", () => {
    const r = runner({ aiAvailable: false });
    r.answer(UNSURE_TEXT);
    expect(r.send({ type: "EDIT", draft: GOOD }).rejected).toBeNull();
    r.send({ type: "SUBMIT" });
    expect(r.ex.outcome?.kind).toBe("self_corrected"); // a later, checkable answer is credited conservatively
    const r2 = runner({ aiAvailable: false });
    r2.answer(UNSURE_TEXT);
    r2.send({ type: "ACCEPT_AS_IS" });
    expect(r2.ex.outcome).toMatchObject({ kind: "unverified" });
  });
});

describe("when the AI cannot help", () => {
  it("every failure leaves the answer unverified with a neutral message, and the learner can continue to transfer without a penalty", () => {
    for (const reason of ["unavailable", "timeout", "rate_limited", "invalid", "offline"] as const) {
      const r = runner();
      r.answer(UNSURE_TEXT);
      r.send({ type: "OPINION", result: { status: "failed", reason } });
      expect(r.ex, reason).toMatchObject({ phase: "unverified", unverifiedReason: `opinion_${reason}`, outcome: null, retriesUsed: 0 });
      expect(viewExercise(r.ex).neutral, reason).toContain("Nothing is counted against you");
      r.send({ type: "ACCEPT_AS_IS" });
      expect(r.ex.outcome?.kind, reason).toBe("unverified");
      r.send({ type: "CONTINUE" });
      r.send({ type: "START_TRANSFER" });
      expect(r.session.stage, reason).toBe("transfer");
      expect(r.ex.itemId, reason).toBe("ppps-transfer-finished"); // no evidence of success → same direction
    }
  });

  it("an opinion that arrives when none was requested is ignored", () => {
    const r = runner();
    expect(r.send({ type: "OPINION", result: ok("fits", "high") }).rejected).toBe("not_waiting_for_opinion");
    expect(r.ex.outcome).toBeNull();
  });
});

describe("parsing what the model returns", () => {
  it("accepts exactly the documented shape", () => {
    expect(parseOpinion({ fit: "fits", confidence: "high" })).toEqual({ status: "ok", opinion: { fit: "fits", confidence: "high", suspected: null } });
    expect(parseOpinion({ fit: "grammar_concern", confidence: "medium", suspected: "participle_form" })).toEqual({ status: "ok", opinion: { fit: "grammar_concern", confidence: "medium", suspected: "participle_form" } });
    expect(parseOpinion({ fit: "unclear", confidence: "low", suspected: null }).status).toBe("ok");
  });

  it("treats anything else as a failure, including extra fields (no smuggled verdicts or scores)", () => {
    const bad: unknown[] = [null, undefined, "fits", 7, [], {}, { fit: "fits" }, { confidence: "high" }, { fit: "wrong", confidence: "high" }, { fit: "fits", confidence: "certain" },
      { fit: "fits", confidence: "high", verdict: "incorrect" }, { fit: "fits", confidence: "high", score: 0 }, { fit: "fits", confidence: "high", suspected: "made_up" }, { fit: "incorrect", confidence: "high" }];
    for (const b of bad) expect(parseOpinion(b), JSON.stringify(b)).toEqual({ status: "failed", reason: "invalid" });
  });
});

describe("the policy, exhaustively: no combination can produce a failure", () => {
  const fits: OpinionFit[] = ["fits", "off_prompt", "incomplete", "grammar_concern", "unclear"];
  const confs: OpinionConfidence[] = ["low", "medium", "high"];

  it("only 'fits' at high confidence can accept; everything else clarifies or leaves it unverified", () => {
    for (const fit of fits) {
      for (const confidence of confs) {
        for (const clarificationsUsed of [0, 1]) {
          const d = decideOnOpinion({ fit, confidence, suspected: null }, { clarificationsUsed, itemCategories: ["pp_with_finished_time"] });
          expect(["accept_fit", "clarify", "unverified"]).toContain(d.action);
          if (d.action === "accept_fit") expect([fit, confidence]).toEqual(["fits", "high"]);
          if (d.action === "clarify") expect(clarificationsUsed).toBe(0);
        }
      }
    }
  });

  it("through the machine: no opinion, however confident, ever yields an incorrect attempt or a 'shown' outcome", () => {
    for (const fit of fits) {
      for (const confidence of confs) {
        const r = runner();
        r.answer(UNSURE_TEXT);
        r.send({ type: "OPINION", result: ok(fit, confidence, "pp_with_finished_time") });
        expect(r.ex.attempts.map((a) => a.verdict), `${fit}/${confidence}`).toEqual(["uncertain"]);
        expect(r.ex.outcome?.kind ?? null).not.toBe("shown");
        expect(r.ex.retriesUsed).toBe(0);
        if (r.ex.outcome) expect(r.ex.outcome.kind).toBe(fit === "fits" ? "first_try" : "unverified");
      }
    }
  });

  it("the deterministic evaluator still has the final say: an AI 'fits' cannot rescue an answer the evaluator called incorrect", () => {
    const r = runner({ evaluate: scripted({ [BAD]: WRONG, [GOOD]: CORRECT }) });
    const out = r.answer(BAD);
    expect(out.effects).toEqual([]); // a clear mistake never asks the AI
    expect(r.ex.phase).toBe("repairing");
    expect(r.send({ type: "OPINION", result: ok("fits", "high") }).rejected).toBe("not_waiting_for_opinion");
  });
});
