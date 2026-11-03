import { expect, it } from "vitest";
import { computeSkillMastery, type EvidenceEvent } from "./mastery";

it("derives exactly identical mastery from every ordering of evidence with tied timestamps", () => {
  const now = 1_800_000_000_000;
  const events: EvidenceEvent[] = Array.from({ length: 16 }, (_, index) => ({
    skillId: "present-perfect-vs-past-simple",
    outcome: index === 0 ? "correct_after_retry" : "correct_first_try",
    source: "lesson",
    groupId: index < 8 ? "phone" : "laptop",
    questionKey: `present-perfect-vs-past-simple/q${index % 8}`,
    at: now - 86_400_000,
  }));
  const expected = computeSkillMastery(events[0].skillId, events, now);
  expect(expected.independent).toBe(15);
  expect(expected.assisted).toBe(1);
  expect(expected.groups).toBe(2);
  for (let index = 0; index < events.length; index++) {
    const rotated = [...events.slice(index), ...events.slice(0, index)];
    expect(computeSkillMastery(events[0].skillId, rotated, now)).toEqual(expected);
    expect(computeSkillMastery(events[0].skillId, rotated.reverse(), now)).toEqual(expected);
  }
});
