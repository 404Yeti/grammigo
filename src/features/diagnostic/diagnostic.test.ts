import { describe, expect, it } from "vitest";
import { listSkills, requireSkill } from "@/curriculum";
import {
  DIAGNOSTIC_CONFIG,
  assessInconclusive,
  buildItemPool,
  canExtend,
  createRun,
  diagnosticEvents,
  extendRun,
  gradeDiagnosticAnswer,
  levelNumber,
  recordResponse,
  selectNextItem,
  stopStatus,
  type DiagnosticItem,
  type DiagnosticRun,
  type ItemOutcome,
} from "./engine";
import { computeAllMastery } from "@/features/learning/mastery";
import { buildProfile } from "@/features/learning/profile";
import { recommendLessons } from "@/features/learning/recommend";

const skills = listSkills();
const pool = buildItemPool(skills);
const NOW = 1_800_000_000_000;

type Policy = (item: DiagnosticItem, askedSoFar: number) => ItemOutcome;

function simulate(policy: Policy, goals: string[] = [], run0?: DiagnosticRun) {
  let run = run0 ?? createRun("run-1", goals, NOW);
  const asked: DiagnosticItem[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const item = selectNextItem(run, pool, skills);
    if (!item) break;
    asked.push(item);
    run = recordResponse(run, item, policy(item, asked.length), NOW + asked.length * 1000);
  }
  return { run, asked };
}

const allCorrect: Policy = () => "correct";
const allWrong: Policy = () => "incorrect";
const allSkipped: Policy = () => "skipped";

const profileFor = (run: DiagnosticRun) => {
  const mastery = computeAllMastery(skills.map((s) => s.id), diagnosticEvents(run), NOW + 60_000);
  return { mastery, profile: buildProfile({ skills, mastery, goalSkillIds: run.goalSkillIds, now: NOW + 60_000 }) };
};

describe("item pool", () => {
  it("contains only curated closed-ended items with known answers", () => {
    expect(pool.length).toBeGreaterThanOrEqual(skills.length * 4);
    for (const item of pool) {
      expect(["multiple-choice", "fill-blank", "multiple-choice-context", "contextual-verb"]).toContain(item.question.type);
      expect(item.question.acceptedAnswers.length).toBeGreaterThan(0);
      expect(item.id).toBe(`${item.skillId}/${item.questionId}`);
    }
  });

  it("grades with the same deterministic grader as lessons", () => {
    const item = pool.find((p) => p.skillId === "a1-be-present" && p.question.type === "multiple-choice")!;
    expect(gradeDiagnosticAnswer(item, item.question.acceptedAnswers[0])).toBe("correct");
    expect(gradeDiagnosticAnswer(item, "zzz")).toBe("incorrect");
  });
});

describe("selection: determinism and variety", () => {
  it("is deterministic: the same responses always lead to the same questions", () => {
    const a = simulate(allCorrect).asked.map((i) => i.id);
    const b = simulate(allCorrect).asked.map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("never repeats a question or tests the same concept twice", () => {
    for (const policy of [allCorrect, allWrong, (i: DiagnosticItem, n: number): ItemOutcome => (n % 2 ? "correct" : "incorrect")]) {
      const { asked } = simulate(policy);
      expect(new Set(asked.map((i) => i.id)).size).toBe(asked.length);
      expect(new Set(asked.map((i) => i.skillId)).size).toBe(asked.length);
    }
  });

  it("keeps a general check (no goals) anchored at the middle of the range first", () => {
    const first = selectNextItem(createRun("r", [], NOW), pool, skills)!;
    expect(requireSkill(first.skillId).cefr).toBe("A2");
  });

  it("starts with the learner's stated goal skill", () => {
    const first = selectNextItem(createRun("r", ["b1-passive-voice"], NOW), pool, skills)!;
    expect(first.skillId).toBe("b1-passive-voice");
  });

  it("starts with a goal-related topic even when the goal skill is a different lesson", () => {
    const first = selectNextItem(createRun("r", ["a2-prepositions-time"], NOW), pool, skills)!;
    expect(first.skillId).toBe("a2-prepositions-time");
  });
});

describe("selection: adapts to performance", () => {
  it("moves up after correct answers and down after wrong ones", () => {
    const up = simulate(allCorrect).asked.slice(0, 4).map((i) => levelNumber(i.cefr));
    const down = simulate(allWrong).asked.slice(0, 4).map((i) => levelNumber(i.cefr));
    expect(Math.max(...up)).toBeGreaterThan(Math.max(...down));
    expect(down.slice(1).every((l) => l <= 2)).toBe(true);
  });

  it("probes the prerequisites of a skill the learner got wrong", () => {
    const run0 = createRun("r", ["b1-passive-voice"], NOW);
    const first = selectNextItem(run0, pool, skills)!;
    const run1 = recordResponse(run0, first, "incorrect", NOW + 1);
    const next = selectNextItem(run1, pool, skills)!;
    expect(requireSkill(first.skillId).prerequisites).toContain(next.skillId);
  });

  it("a clear beginner (everything wrong) stops early at the minimum, not after ten", () => {
    const { run, asked } = simulate(allWrong);
    expect(asked.length).toBe(DIAGNOSTIC_CONFIG.minQuestions);
    expect(stopStatus(run).reason).toBe("clear-floor");
  });
});

describe("length", () => {
  it("asks between 5 and 10 questions for a normal learner", () => {
    const { asked } = simulate((i, n) => (n % 3 === 0 ? "incorrect" : "correct"));
    expect(asked.length).toBeGreaterThanOrEqual(DIAGNOSTIC_CONFIG.minQuestions);
    expect(asked.length).toBeLessThanOrEqual(DIAGNOSTIC_CONFIG.maxQuestions);
  });

  it("finishes the run and records a finish time", () => {
    const { run } = simulate(allCorrect);
    expect(run.finishedAt).not.toBeNull();
    expect(selectNextItem(run, pool, skills)).toBeNull();
  });
});

describe("skipped and inconclusive responses", () => {
  it("lets every question be skipped and treats skips as no evidence", () => {
    const { run } = simulate((i, n) => (n === 2 ? "skipped" : "correct"));
    expect(run.responses.some((r) => r.outcome === "skipped")).toBe(true);
    expect(diagnosticEvents(run).length).toBe(run.responses.filter((r) => r.outcome !== "skipped").length);
  });

  it("stops after a run of skips instead of nagging", () => {
    const { run, asked } = simulate(allSkipped);
    expect(asked.length).toBe(DIAGNOSTIC_CONFIG.maxSkipRun);
    expect(stopStatus(run).reason).toBe("disengaged");
    expect(diagnosticEvents(run)).toHaveLength(0);
    const { profile } = profileFor(run);
    expect(profile.unassessed).toHaveLength(skills.length); // skipping is not failing
    expect(profile.weaknesses).toHaveLength(0);
  });

  it("offers an optional extension when the base run is inconclusive, and allows more questions after", () => {
    // Skip two of every three (never three in a row): inconclusive, but not disengaged.
    const policy: Policy = (i, n) => (n % 3 === 0 ? "correct" : "skipped");
    const { run } = simulate(policy);
    expect(run.responses.length).toBe(DIAGNOSTIC_CONFIG.maxQuestions);
    expect(assessInconclusive(run).inconclusive).toBe(true);
    expect(canExtend(run)).toBe(true);

    const extended = extendRun(run);
    expect(extended.finishedAt).toBeNull();
    const { run: after } = simulate(policy, [], extended);
    expect(after.responses.length).toBeGreaterThan(DIAGNOSTIC_CONFIG.maxQuestions);
    expect(after.responses.length).toBeLessThanOrEqual(DIAGNOSTIC_CONFIG.maxQuestions + DIAGNOSTIC_CONFIG.extensionQuestions);
    expect(canExtend(after)).toBe(false); // only once
  });

  it("does not offer an extension for a conclusive run", () => {
    const { run } = simulate(allCorrect);
    expect(assessInconclusive(run).inconclusive).toBe(false);
    expect(canExtend(run)).toBe(false);
  });

  it("flags a goal area that was never answered as inconclusive", () => {
    const run = createRun("r", ["b2-reported-speech"], NOW);
    const item = pool.find((p) => p.skillId === "a1-articles")!;
    const r1 = recordResponse(run, item, "correct", NOW + 1);
    expect(assessInconclusive(r1).reasons.join(" ")).toMatch(/areas you mentioned/);
  });
});

describe("mixed-level learners", () => {
  it("B2 strengths with an A2 past-simple gap: finds the gap and recommends A2 remediation, not a B2 lesson", () => {
    const gap = "a2-past-simple";
    const policy: Policy = (item) => (item.skillId === gap ? "incorrect" : "correct");
    const { run, asked } = simulate(policy);

    expect(asked.some((i) => i.skillId === gap)).toBe(true); // prerequisite probing reaches the gap
    expect(asked.some((i) => levelNumber(i.cefr) >= 3)).toBe(true); // and still explores higher levels

    const { mastery, profile } = profileFor(run);
    expect(profile.weaknesses.map((w) => w.skillId)).toContain(gap);
    expect(profile.strengths.length).toBeGreaterThan(0);
    expect(profile.mixedLevel).toBe(true);

    const [first] = recommendLessons({ skills, mastery, goalSkillIds: [], now: NOW + 60_000 });
    expect(first.skillId).toBe(gap);
    expect(requireSkill(first.skillId).cefr).toBe("A2");
  });

  it("evidence from one item stays provisional and is never presented as mastery", () => {
    const { run } = simulate(allCorrect);
    const { mastery } = profileFor(run);
    for (const m of mastery.values()) {
      if (m.status !== "not_assessed") {
        expect(m.provisional).toBe(true);
        expect(m.status).not.toBe("strong");
      }
    }
  });
});

describe("recording", () => {
  it("ignores a duplicate response to the same item", () => {
    const run = createRun("r", [], NOW);
    const item = selectNextItem(run, pool, skills)!;
    const once = recordResponse(run, item, "correct", NOW + 1);
    expect(recordResponse(once, item, "incorrect", NOW + 2)).toBe(once);
  });

  it("uses lesson-compatible evidence keys so diagnostic and lesson answers to the same question line up", () => {
    const { run } = simulate(allCorrect);
    for (const e of diagnosticEvents(run)) {
      expect(e.questionKey).toMatch(/^[a-z0-9-]+\/q\d$/);
      expect(e.source).toBe("diagnostic");
    }
  });
});
