import type { Lesson } from "@/types/lesson";
import { A1_SKILLS } from "./catalog/a1";
import { A2_SKILLS } from "./catalog/a2";
import { B_SKILLS } from "./catalog/b1-b2";
import {
  CEFR_LEVELS,
  CURRICULUM_SCHEMA_VERSION,
  type CefrLevel,
  type Curriculum,
  type CurriculumSkill,
} from "./schema";
import { validateCurriculum } from "./validate";

/**
 * The curated catalog, validated when first imported: a content mistake fails the build and tests
 * instead of reaching a learner. C1/C2 are supported by the schema but intentionally have no
 * lessons yet; nothing unreviewed is generated.
 */
export const CURRICULUM: Curriculum = validateCurriculum({
  schemaVersion: CURRICULUM_SCHEMA_VERSION,
  skills: [...A1_SKILLS, ...A2_SKILLS, ...B_SKILLS],
});

const BY_ID = new Map(CURRICULUM.skills.map((s) => [s.id, s]));

export function listSkills(): readonly CurriculumSkill[] {
  return CURRICULUM.skills;
}

export function getCurriculumSkill(id: string): CurriculumSkill | undefined {
  return BY_ID.get(id);
}

export function requireSkill(id: string): CurriculumSkill {
  const skill = BY_ID.get(id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
}

/** Position in the curated order; used as a stable tie-breaker everywhere. */
export function skillOrder(id: string): number {
  return CURRICULUM.skills.findIndex((s) => s.id === id);
}

export function levelIndex(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level);
}

export function skillsAtLevel(level: CefrLevel): CurriculumSkill[] {
  return CURRICULUM.skills.filter((s) => s.cefr === level);
}

/** Levels that have at least one lesson. */
export function availableLevels(): CefrLevel[] {
  return CEFR_LEVELS.filter((l) => skillsAtLevel(l).length > 0);
}

export function listTopics(): string[] {
  return [...new Set(CURRICULUM.skills.map((s) => s.topic))];
}

/** Adapts a curriculum skill to the lesson shape the existing eight-exercise engine plays. */
export function toLesson(skill: CurriculumSkill): Lesson {
  return {
    id: skill.id,
    title: skill.title,
    grammarFocus: skill.topic,
    minutes: skill.estimatedMinutes,
    intro: skill.intro,
    objectives: skill.objectives,
    homeReason: skill.homeReason,
    questions: skill.questions,
  };
}
