import type { CurriculumSkill } from "@/curriculum/schema";
import type { GoalItem, LearnerGoals } from "@/types/session";

/**
 * Offline goal matching: maps the learner's own words to curriculum skills by keyword. It is the
 * fallback whenever AI is off or fails, so onboarding never depends on a network call. It does not
 * try to be clever: no match simply means a general grammar check.
 */
export function extractGoalsLocally(text: string, skills: readonly CurriculumSkill[]): { goals: GoalItem[]; skillIds: string[] } {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9’']+/g, " ")} `;
  const scored = skills
    .map((skill) => {
      let score = 0;
      for (const keyword of skill.keywords) {
        const k = ` ${keyword.toLowerCase()} `;
        if (haystack.includes(k)) score += keyword.includes(" ") ? 2 : 1;
      }
      return { skill, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || skills.indexOf(a.skill) - skills.indexOf(b.skill))
    .slice(0, 4);

  return {
    goals: scored.map(({ skill }) => ({ label: skill.subtopic, skillIds: [skill.id] })),
    skillIds: scored.map(({ skill }) => skill.id),
  };
}

export function buildGoals(input: {
  text: string;
  source: "typed" | "spoken";
  goals: GoalItem[];
  skillIds: string[];
  extractedBy: "ai" | "local";
  now: number;
}): LearnerGoals {
  return { text: input.text, source: input.source, goals: input.goals, skillIds: input.skillIds, extractedBy: input.extractedBy, updatedAt: input.now };
}

/** The "skip the conversation" path: a general grammar check with no stated goals. */
export function noGoals(now: number): LearnerGoals {
  return { text: "", source: "none", goals: [], skillIds: [], extractedBy: "none", updatedAt: now };
}
