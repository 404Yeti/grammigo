import { describe, expect, it } from "vitest";
import { listSkills, requireSkill } from "@/curriculum";
import {
  buildItemPool,
  createRun,
  diagnosticEvents,
  levelNumber,
  recordResponse,
  selectNextItem,
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

type Policy = (item: DiagnosticItem, n: number) => ItemOutcome;

function journey(policy: Policy, goals: string[] = []) {
  let run: DiagnosticRun = createRun("scenario", goals, NOW);
  const asked: DiagnosticItem[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const item = selectNextItem(run, pool, skills);
    if (!item) break;
    asked.push(item);
    run = recordResponse(run, item, policy(item, asked.length), NOW + asked.length * 1000);
  }
  const at = NOW + 60_000;
  const mastery = computeAllMastery(skills.map((s) => s.id), diagnosticEvents(run), at);
  const profile = buildProfile({ skills, mastery, goalSkillIds: goals, now: at });
  const [first] = recommendLessons({ skills, mastery, goalSkillIds: goals, now: at });
  return { asked, profile, first };
}

const upTo = (level: number): Policy => (item) => (levelNumber(item.cefr) <= level ? "correct" : "incorrect");

describe("learner archetypes: the whole diagnostic → profile → recommendation path", () => {
  it("beginner (only A1 items right): is not sent to B-level lessons", () => {
    const { first, asked } = journey(upTo(1));
    expect(asked.length).toBeGreaterThanOrEqual(5);
    expect(["A1", "A2"]).toContain(requireSkill(first.skillId).cefr);
  });

  it("intermediate (A1–A2 right, B wrong): recommendation is never an A1 repeat of a strength", () => {
    const { first, profile } = journey(upTo(2));
    expect(profile.strengths.length).toBeGreaterThan(0);
    expect(profile.strengths.map((s) => s.skillId)).not.toContain(first.skillId);
  });

  it("advanced (everything right): claims no mastery from one short check and offers a next step", () => {
    const { first, profile } = journey(upTo(4));
    expect(first).toBeDefined();
    expect(profile.weaknesses).toHaveLength(0);
  });

  it("mixed ability (B2 right, one A2 gap that was asked about): recommends the A2 gap", () => {
    // The check samples; it can only find a gap in a skill it actually asked about.
    const probe = journey(() => "correct").asked.find((i) => i.cefr === "A2")!;
    const { first } = journey((item) => (item.skillId === probe.skillId ? "incorrect" : "correct"));
    expect(first.skillId).toBe(probe.skillId);
  });

  it("incomplete onboarding (everything skipped): no weaknesses invented, still recommends something", () => {
    const { first, profile } = journey(() => "skipped");
    expect(profile.weaknesses).toHaveLength(0);
    expect(first).toBeDefined();
  });

  it("a stated goal is honored when evidence is thin", () => {
    const goal = "b1-passive-voice";
    const { first } = journey(() => "skipped", [goal]);
    expect(first.skillId).toBe(goal);
  });

  it("no profile entry ever carries a CEFR level for the learner", () => {
    const { profile } = journey(upTo(3));
    expect(JSON.stringify(profile)).not.toMatch(/"(learnerLevel|cefrLevel|overallLevel)"/);
  });
});
