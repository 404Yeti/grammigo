import { describe, expect, it } from "vitest";
import { listSkills, requireSkill } from "@/curriculum";
import {
  DEFAULT_MASTERY_CONFIG,
  computeAllMastery,
  computeSkillMastery,
  type EvidenceEvent,
  type MasteryConfig,
} from "./mastery";
import { buildProfile } from "./profile";
import { explainRecommendationChange, prerequisiteReadiness, recommendLessons } from "./recommend";
import type { Classification } from "@/types/session";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const skills = listSkills();
const ids = skills.map((s) => s.id);

let n = 0;
function ev(
  skillId: string,
  outcome: Classification,
  opts: { group?: string; daysAgo?: number; source?: "lesson" | "diagnostic"; q?: string } = {},
): EvidenceEvent {
  n += 1;
  return {
    skillId,
    outcome,
    source: opts.source ?? "lesson",
    groupId: opts.group ?? "g1",
    questionKey: `${skillId}/${opts.q ?? `q${n}`}`,
    at: NOW - (opts.daysAgo ?? 0) * DAY,
  };
}

/** A whole sitting: `outcomes` for one skill. */
function sitting(skillId: string, group: string, outcomes: Classification[], daysAgo = 0): EvidenceEvent[] {
  return outcomes.map((o, i) => ev(skillId, o, { group, daysAgo, q: `q${i + 1}` }));
}
const eight = (o: Classification, miss = 0): Classification[] =>
  Array.from({ length: 8 }, (_, i) => (i < miss ? "incorrect" : o));

const mastery = (events: EvidenceEvent[], config?: MasteryConfig) =>
  computeAllMastery(ids, events, NOW, config);
const recs = (events: EvidenceEvent[], goalSkillIds: string[] = []) =>
  recommendLessons({ skills, mastery: mastery(events), goalSkillIds, now: NOW });

describe("mastery: cold start and insufficient evidence", () => {
  it("has no opinion without evidence", () => {
    const m = computeSkillMastery("a1-articles", [], NOW);
    expect(m.status).toBe("not_assessed");
    expect(m.score).toBeNull();
    expect(m.confidence).toBe("none");
  });

  it("treats a single correct diagnostic answer as an early read, not mastery", () => {
    const m = computeSkillMastery("a1-articles", [ev("a1-articles", "correct_first_try", { source: "diagnostic" })], NOW);
    expect(m.status).toBe("learning");
    expect(m.provisional).toBe(true);
    expect(m.confidence).toBe("insufficient");
    expect(m.reasons.join(" ")).toMatch(/small amount of evidence/);
  });

  it("does not equate one perfect lesson with mastery", () => {
    const m = computeSkillMastery("a1-articles", sitting("a1-articles", "s1", eight("correct_first_try")), NOW);
    expect(m.score).toBe(1);
    expect(m.status).not.toBe("strong");
    expect(m.status).toBe("developing");
  });
});

describe("mastery: assisted success, repeated failure, strength", () => {
  it("weighs assisted success below independent success", () => {
    const independent = computeSkillMastery("a1-articles", sitting("a1-articles", "s1", eight("correct_first_try")), NOW);
    const assisted = computeSkillMastery("a1-articles", sitting("a1-articles", "s1", eight("correct_after_hint")), NOW);
    expect(assisted.score!).toBeLessThan(independent.score!);
    expect(assisted.score).toBe(0.5);
    expect(assisted.assisted).toBe(8);
    // Everything was right, but only with help: early progress, never "strong" or "developing".
    expect(assisted.status).toBe("learning");
  });

  it("flags needs_practice and recurring errors after repeated failures", () => {
    const events = [
      ...sitting("a1-articles", "s1", eight("correct_first_try", 4), 6),
      ...sitting("a1-articles", "s2", eight("correct_first_try", 4), 1),
    ];
    const m = computeSkillMastery("a1-articles", events, NOW);
    expect(m.status).toBe("needs_practice");
    expect(m.recurringErrors).toHaveLength(4);
    expect(m.reasons.join(" ")).toMatch(/repeated mistake/);
  });

  it("reaches strong only with enough evidence over several sittings and no repeated mistakes", () => {
    const events = [
      ...sitting("a1-articles", "s1", eight("correct_first_try"), 3),
      ...sitting("a1-articles", "s2", eight("correct_first_try"), 0),
    ];
    const m = computeSkillMastery("a1-articles", events, NOW);
    expect(m.status).toBe("strong");
    expect(m.confidence).toBe("high");
    expect(m.provisional).toBe(false);
  });

  it("will not call a skill strong if the same questions keep needing help", () => {
    const o = (i: number): Classification => (i === 0 ? "correct_after_retry" : "correct_first_try");
    const events = [
      ...Array.from({ length: 8 }, (_, i) => ev("a1-articles", o(i), { group: "s1", daysAgo: 2, q: `q${i + 1}` })),
      ...Array.from({ length: 8 }, (_, i) => ev("a1-articles", o(i), { group: "s2", daysAgo: 0, q: `q${i + 1}` })),
    ];
    const m = computeSkillMastery("a1-articles", events, NOW);
    expect(m.recurringErrors).toEqual(["a1-articles/q1"]);
    expect(m.status).not.toBe("strong");
  });

  it("weights recent evidence above old evidence", () => {
    const old = sitting("a1-articles", "old", eight("correct_first_try", 8), 120);
    const recent = sitting("a1-articles", "new", eight("correct_first_try"), 0);
    expect(computeSkillMastery("a1-articles", [...old, ...recent], NOW).score!).toBeGreaterThan(0.9);
  });

  it("uses configurable thresholds", () => {
    const events = sitting("a1-articles", "s1", eight("correct_first_try", 5)); // score 0.375
    const lenient: MasteryConfig = { ...DEFAULT_MASTERY_CONFIG, needsPracticeBelow: 0.3 };
    expect(computeSkillMastery("a1-articles", events, NOW).status).toBe("needs_practice");
    expect(computeSkillMastery("a1-articles", events, NOW, lenient).status).not.toBe("needs_practice");
  });
});

describe("mastery: review scheduling", () => {
  it("schedules the first review one day after a good sitting", () => {
    const m = computeSkillMastery("a1-articles", sitting("a1-articles", "s1", eight("correct_first_try")), NOW);
    expect(m.reviewDueAt).toBe(NOW + 1 * DAY);
    expect(m.reviewDue).toBe(false);
  });

  it("lengthens the interval after consecutive good sittings", () => {
    const events = [
      ...sitting("a1-articles", "s1", eight("correct_first_try"), 10),
      ...sitting("a1-articles", "s2", eight("correct_first_try"), 5),
      ...sitting("a1-articles", "s3", eight("correct_first_try"), 0),
    ];
    const m = computeSkillMastery("a1-articles", events, NOW);
    expect(m.reviewDueAt).toBe(NOW + 7 * DAY); // third good sitting → interval index 2
  });

  it("resets the interval after a weak sitting", () => {
    const events = [
      ...sitting("a1-articles", "s1", eight("correct_first_try"), 10),
      ...sitting("a1-articles", "s2", eight("correct_first_try"), 5),
      ...sitting("a1-articles", "s3", eight("correct_first_try", 6), 0),
    ];
    expect(computeSkillMastery("a1-articles", events, NOW).reviewDueAt).toBe(NOW + 1 * DAY);
  });

  it("marks a skill review-due once its interval has passed", () => {
    const m = computeSkillMastery("a1-articles", sitting("a1-articles", "s1", eight("correct_first_try"), 4), NOW);
    expect(m.reviewDue).toBe(true);
  });
});

describe("prerequisites", () => {
  it("is ready when there are no prerequisites, unknown when they have no evidence", () => {
    expect(prerequisiteReadiness(requireSkill("a1-articles"), mastery([])).state).toBe("ready");
    expect(prerequisiteReadiness(requireSkill("a1-present-simple"), mastery([])).state).toBe("unknown");
  });

  it("is not ready only on evidence of weakness", () => {
    const m = mastery(sitting("a1-be-present", "s1", eight("correct_first_try", 6)));
    const r = prerequisiteReadiness(requireSkill("a1-present-simple"), m);
    expect(r.state).toBe("not_ready");
    expect(r.weak).toEqual(["a1-be-present"]);
  });

  it("is ready when prerequisites are doing well", () => {
    const m = mastery(sitting("a1-be-present", "s1", eight("correct_first_try")));
    expect(prerequisiteReadiness(requireSkill("a1-present-simple"), m).state).toBe("ready");
  });
});

describe("recommendations", () => {
  it("cold start: recommends a friendly A1 foundation and says there is no evidence yet", () => {
    const [first] = recs([]);
    expect(first.kind).toBe("new");
    expect(requireSkill(first.skillId).cefr).toBe("A1");
    expect(first.reason).toMatch(/don’t have any evidence/);
  });

  it("cold start with a stated goal: starts with the goal skill and says why", () => {
    const [first] = recs([], ["a2-prepositions-time"]);
    expect(first.skillId).toBe("a2-prepositions-time");
    expect(first.kind).toBe("goal");
    expect(first.reason).toMatch(/told Migo/);
  });

  it("repeated failures: recommends focused practice on the weak skill", () => {
    const events = [
      ...sitting("a1-articles", "s1", eight("correct_first_try", 5), 5),
      ...sitting("a1-articles", "s2", eight("correct_first_try", 5), 0),
    ];
    const [first] = recs(events);
    expect(first.skillId).toBe("a1-articles");
    expect(first.kind).toBe("weak");
    expect(first.reason).toMatch(/more than once/);
  });

  it("assisted success: keeps practicing instead of calling it done", () => {
    const events = sitting("a1-articles", "s1", [...Array(8)].map(() => "correct_after_retry" as Classification).map((o, i) => (i < 5 ? o : "correct_first_try")));
    const top = recs(events).find((r) => r.skillId === "a1-articles")!;
    expect(["continue", "weak"]).toContain(top.kind);
  });

  it("mastered skills are not recommended again until review is due", () => {
    const strong = [
      ...sitting("a1-be-present", "s1", eight("correct_first_try"), 6),
      ...sitting("a1-be-present", "s2", eight("correct_first_try"), 0),
    ];
    expect(recs(strong).some((r) => r.skillId === "a1-be-present")).toBe(false);
    const dueLater = [
      ...sitting("a1-be-present", "s1", eight("correct_first_try"), 40),
      ...sitting("a1-be-present", "s2", eight("correct_first_try"), 30),
    ];
    const review = recs(dueLater).find((r) => r.skillId === "a1-be-present")!;
    expect(review.kind).toBe("review");
    expect(review.reason).toMatch(/30 days ago/);
  });

  it("remediates a weak prerequisite before the lesson that depends on it", () => {
    const events = [
      ...sitting("a1-be-present", "s1", eight("correct_first_try", 6)),
      ...sitting("a1-present-simple", "s2", eight("correct_first_try", 7)),
    ];
    const [first] = recs(events);
    expect(first.skillId).toBe("a1-be-present");
    expect(first.kind).toBe("remediation");
    expect(first.forSkillId).toBe("a1-present-simple");
    expect(first.reason).toMatch(/Before “Present simple: routines”/);
  });

  it("mixed-level learner: B2 strengths with an A2 gap is sent to A2 remediation, not forward", () => {
    const events = [
      ...sitting("b2-reported-speech", "s1", eight("correct_first_try"), 1),
      ...sitting("b1-first-conditional", "s2", eight("correct_first_try"), 1),
      ...sitting("a2-past-simple", "s3", eight("correct_first_try", 6), 1),
    ];
    const profile = buildProfile({ skills, mastery: mastery(events), goalSkillIds: [], now: NOW });
    expect(profile.mixedLevel).toBe(true);
    expect(profile.highestStrengthLevel).toBe("B2");
    expect(profile.weaknesses.map((w) => w.skillId)).toContain("a2-past-simple");

    const [first] = recs(events);
    expect(first.skillId).toBe("a2-past-simple");
    expect(["weak", "remediation"]).toContain(first.kind);
    expect(requireSkill(first.skillId).cefr).toBe("A2");
  });

  it("ranking is deterministic", () => {
    const events = sitting("a2-quantifiers", "s1", eight("correct_first_try", 5));
    expect(recs(events)).toEqual(recs(events));
  });

  it("never recommends nothing: falls back to the soonest review", () => {
    const all = ids.flatMap((id) => [
      ...sitting(id, `${id}-a`, eight("correct_first_try"), 5),
      ...sitting(id, `${id}-b`, eight("correct_first_try"), 0),
    ]);
    const list = recs(all);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("review");
  });
});

describe("recommendation explanations", () => {
  const titleOf = (id: string) => requireSkill(id).title;

  it("explains the first recommendation with its own reason", () => {
    const [next] = recs([]);
    expect(explainRecommendationChange({ previous: null, next, titleOf })).toBe(next.reason);
  });

  it("explains why the recommendation changed after a lesson", () => {
    const before = recs([])[0];
    const events = sitting(before.skillId, "s1", eight("correct_first_try", 6));
    const next = recs(events)[0];
    const text = explainRecommendationChange({
      previous: { skillId: before.skillId, kind: before.kind, at: NOW },
      next,
      titleOf,
      lastLesson: { skillId: before.skillId, independent: 2, assisted: 0, incorrect: 6, total: 8 },
    });
    expect(text).toMatch(/You finished “/);
    expect(text).toMatch(/2 of 8 answers on your own/);
    expect(text).toMatch(/6 that needed help or were missed/);
  });

  it("says so when the lesson is the same but the reason changed", () => {
    const next = recs(sitting("a1-articles", "s1", eight("correct_first_try", 6)))[0];
    const text = explainRecommendationChange({ previous: { skillId: next.skillId, kind: "new", at: NOW }, next, titleOf });
    expect(text).toMatch(/still suggesting “Articles: a, an, the”, but for a different reason/);
    expect(text).not.toMatch(/instead/);
  });

  it("names both lessons when the suggestion actually changes", () => {
    const next = recs(sitting("a1-articles", "s1", eight("correct_first_try", 6)))[0];
    const text = explainRecommendationChange({ previous: { skillId: "a2-comparatives", kind: "new", at: NOW }, next, titleOf });
    expect(text).toMatch(/Last time we suggested “Comparatives and superlatives”; now we suggest “Articles: a, an, the” instead/);
  });

  it("says when it is still the same suggestion", () => {
    const next = recs(sitting("a1-articles", "s1", eight("correct_first_try", 6)))[0];
    const text = explainRecommendationChange({ previous: { skillId: next.skillId, kind: next.kind, at: NOW }, next, titleOf });
    expect(text).toMatch(/still suggesting/);
  });
});

describe("profile", () => {
  it("is honest when there is no evidence", () => {
    const p = buildProfile({ skills, mastery: mastery([]), goalSkillIds: [], now: NOW });
    expect(p.unassessed).toHaveLength(skills.length);
    expect(p.strengths).toHaveLength(0);
    expect(p.headline).toMatch(/don’t have evidence/);
    expect(p.caveat).toMatch(/not a CEFR level/);
  });

  it("separates strengths, weaknesses, in-progress and unassessed", () => {
    const events = [
      ...sitting("a1-be-present", "s1", eight("correct_first_try")),
      ...sitting("a1-articles", "s2", eight("correct_first_try", 6)),
      ...sitting("a2-comparatives", "s3", eight("correct_first_try", 3)),
    ];
    const p = buildProfile({ skills, mastery: mastery(events), goalSkillIds: ["a1-articles"], now: NOW });
    expect(p.strengths.map((e) => e.skillId)).toContain("a1-be-present");
    expect(p.weaknesses.map((e) => e.skillId)).toContain("a1-articles");
    expect(p.inProgress.map((e) => e.skillId)).toContain("a2-comparatives");
    expect(p.unassessed.length).toBe(skills.length - 3);
    expect(p.entries.find((e) => e.skillId === "a1-articles")!.isGoal).toBe(true);
  });

  it("never reports a CEFR level for the learner", () => {
    const p = buildProfile({ skills, mastery: mastery(sitting("a1-be-present", "s1", eight("correct_first_try"))), goalSkillIds: [], now: NOW });
    expect(JSON.stringify(p.headline)).not.toMatch(/\b(A1|A2|B1|B2) level\b/);
    expect(p.caveat).toMatch(/not a CEFR level/);
  });
});
