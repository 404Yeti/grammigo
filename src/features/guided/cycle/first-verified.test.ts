import type { TargetCategory } from "@/features/guided/evaluator/types";
import { describe, expect, it } from "vitest";
import type { OpinionConfidence, OpinionFit } from "@/types/guided";
import { wasCorrectedBefore } from "./machine";
import { outcomeRecords, summarizeOutcomes } from "./outcome";
import type { OpinionResult } from "./opinion";
import { runner } from "./testkit";

/**
 * Owner rule (Phase 4): the first VERIFIED correct answer earns first-try credit unless something
 * corrective came before it: an answer marked incorrect (with its notice), a hint, or an AI grammar
 * clarification. Earlier unverified submissions never disqualify; they are tracked separately.
 */
const UNSURE = "I have watched a film."; // real evaluator: uncertain
const UNSURE2 = "I have cooked dinner."; // uncertain too
const GOOD = "I watched a film with my sister.";
const BAD = "I have watched a film yesterday evening.";
const ok = (fit: OpinionFit, confidence: OpinionConfidence, suspected: TargetCategory | null = null): OpinionResult => ({ status: "ok", opinion: { fit, confidence, suspected } });
const kind = (r: ReturnType<typeof runner>) => r.ex.outcome?.kind;
const earlier = (r: ReturnType<typeof runner>) => outcomeRecords([r.session])[0].earlierUnverified;

describe("earlier unverified submissions do not disqualify first try", () => {
  it("unverified (no second opinion available) → correct = first try, and the unverified submission is tracked separately", () => {
    const r = runner({ aiAvailable: false });
    r.answer(UNSURE);
    expect(r.ex.phase).toBe("unverified");
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try");
    expect(earlier(r)).toBe(1);
    expect(summarizeOutcomes({ sessions: [r.session] }).earlierUnverified).toBe(1);
  });

  it("two unverified submissions, then a correct one = first try, tracked as two", () => {
    const r = runner({ aiAvailable: false });
    r.answer(UNSURE);
    r.answer(UNSURE2);
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try");
    expect(earlier(r)).toBe(2);
  });

  it("the AI said 'incomplete' (not a grammar matter) → a fuller correct answer is still first try", () => {
    const r = runner();
    r.answer(UNSURE);
    r.send({ type: "OPINION", result: ok("incomplete", "high") });
    expect(r.ex.phase).toBe("clarifying");
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try");
  });

  it("the AI confirms a fit after an earlier unverified answer → first try, AI-confirmed, earlier one tracked", () => {
    const r2 = runner();
    r2.answer(UNSURE);
    r2.send({ type: "OPINION", result: { status: "failed", reason: "timeout" } });
    r2.answer(UNSURE2);
    r2.send({ type: "OPINION", result: ok("fits", "high") });
    expect(r2.ex.outcome).toMatchObject({ kind: "first_try", basis: "ai_second_opinion" });
    expect(earlier(r2)).toBe(1); // the deciding (AI-confirmed) answer is not counted as an earlier unverified one
  });

  it("a low-confidence grammar concern gives no guidance (it ends unverified), so it does not disqualify", () => {
    const r = runner();
    r.answer(UNSURE);
    r.send({ type: "OPINION", result: ok("grammar_concern", "low") });
    expect(r.ex.phase).toBe("unverified");
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try");
  });

  it("a grammar concern after the one clarification was already used gave no guidance either → still first try", () => {
    const r = runner();
    r.answer(UNSURE);
    r.send({ type: "OPINION", result: ok("incomplete", "high") }); // clarification used
    r.answer(UNSURE2);
    r.send({ type: "OPINION", result: ok("grammar_concern", "high", "pp_with_finished_time") }); // no second clarification: unverified
    expect(r.ex.phase).toBe("unverified");
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try");
  });
});

describe("corrective help before the correct answer still means it is not first try", () => {
  it("an answer marked incorrect, then correct = self-corrected", () => {
    const r = runner();
    r.answer(BAD);
    r.answer(GOOD);
    expect(kind(r)).toBe("self_corrected");
  });

  it("incorrect → hint → correct = hint-assisted", () => {
    const r = runner();
    r.answer(BAD);
    r.send({ type: "REQUEST_HINT" });
    r.answer(GOOD);
    expect(kind(r)).toBe("hint_assisted");
  });

  it("a learner who already received a hint and then submits an unverified answer is NOT promoted to first try", () => {
    const r = runner({ aiAvailable: false });
    r.answer(BAD);
    r.send({ type: "REQUEST_HINT" });
    r.answer(UNSURE);
    expect(r.ex.phase).toBe("unverified");
    r.answer(GOOD);
    expect(kind(r)).toBe("hint_assisted");
    expect(earlier(r)).toBe(1);
  });

  it("incorrect → unverified → correct = self-corrected (the earlier mistake was real)", () => {
    const r = runner({ aiAvailable: false });
    r.answer(BAD);
    r.answer(UNSURE);
    r.answer(GOOD);
    expect(kind(r)).toBe("self_corrected");
  });

  it("an AI grammar clarification is corrective guidance: fixing it afterwards is self-corrected, not first try", () => {
    const r = runner();
    r.answer(UNSURE);
    r.send({ type: "OPINION", result: ok("grammar_concern", "high", "pp_with_finished_time") }); // corroborated by the evaluator's suspicion
    expect(r.ex.phase).toBe("clarifying");
    r.answer(GOOD);
    expect(kind(r)).toBe("self_corrected");
  });

  it("an AI concern the evaluator did NOT corroborate shows no guidance, so it cannot remove first try (owner decision, Phase 5)", () => {
    for (const suspected of [null, "participle_form"] as const) {
      const r = runner();
      r.answer(UNSURE);
      r.send({ type: "OPINION", result: ok("grammar_concern", "high", suspected) });
      expect(r.ex.phase).toBe("unverified");
      expect(wasCorrectedBefore({ ...r.ex, attempts: [...r.ex.attempts, { ...r.ex.attempts[0], verdict: "correct" }] })).toBe(false);
      r.answer(GOOD);
      expect(kind(r)).toBe("first_try");
    }
  });

  it("only explicit, evaluator-supported corrective help counts: a verified mistake, a hint, or guidance", () => {
    const r = runner({ aiAvailable: false });
    r.answer(UNSURE);
    r.answer(UNSURE2);
    r.answer(GOOD);
    expect(kind(r)).toBe("first_try"); // several unverified submissions and nothing corrective
  });

  it("Show me is never first try", () => {
    const r = runner({ aiAvailable: false });
    r.answer(UNSURE);
    r.send({ type: "SHOW_ME" });
    expect(kind(r)).toBe("shown");
  });

  it("transfer follows the same rule", () => {
    const r = runner({ aiAvailable: false });
    r.answer(GOOD);
    r.send({ type: "CONTINUE" });
    r.send({ type: "START_TRANSFER" });
    r.answer("I will learn English tomorrow."); // not about the question: unverified
    r.answer("I have been learning English for three years.");
    expect(kind(r)).toBe("first_try");
  });
});

describe("the helper", () => {
  it("looks only at what came before the deciding answer", () => {
    const r = runner({ aiAvailable: false });
    r.answer(GOOD);
    expect(wasCorrectedBefore(r.ex)).toBe(false);
  });
});
