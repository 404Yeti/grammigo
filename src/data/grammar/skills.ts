import type { Skill } from "@/types/lesson";
import { getCurriculumSkill } from "@/curriculum";

/** Review copy for the v0.1 lesson's sub-skills (kept so migrated sessions review the same way). */
export const SKILLS: Record<string, Skill> = {
  "present-perfect-form": {
    id: "present-perfect-form",
    title: "Recognizing the present perfect",
    strengthText: "You spotted the present perfect: have/has plus a past participle.",
    practiceText: "Look for have/has + a past participle, with no finished time word.",
  },
  "past-simple-finished-time": {
    id: "past-simple-finished-time",
    title: "Past simple with finished time expressions",
    strengthText: "You used the past simple correctly with finished times.",
    practiceText:
      "Remember: yesterday, last weekend, ago, and in 2020 usually refer to completed periods.",
  },
  "present-perfect-since-for": {
    id: "present-perfect-since-for",
    title: "Present perfect with since and for",
    strengthText:
      "You correctly recognized when an action began in the past and continues into the present.",
    practiceText:
      "Use since with a starting point (2021) and for with a length of time (three years).",
  },
  "present-perfect-construction": {
    id: "present-perfect-construction",
    title: "Building sentences with have + past participle",
    strengthText: "You built a present perfect sentence without help.",
    practiceText: "Build it in order: subject + have/has + past participle + the rest.",
  },
  "tense-contrast-writing": {
    id: "tense-contrast-writing",
    title: "Writing both tenses on your own",
    strengthText: "You wrote a sentence in each tense on your own.",
    practiceText: "Write one sentence with have/has + a participle and one with a finished time.",
  },
};

/** Copy for a question's skillId: a v0.1 sub-skill, or a curriculum skill (lesson). */
export function getSkill(id: string): Skill {
  const sub = SKILLS[id];
  if (sub) return sub;
  const skill = getCurriculumSkill(id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return {
    id: skill.id,
    title: skill.title,
    strengthText: skill.review.strengthText,
    practiceText: skill.review.practiceText,
  };
}
