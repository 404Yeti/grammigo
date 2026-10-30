import { normalizeAnswer } from "@/features/practice/normalize";
import { CEFR_LEVELS, curriculumSchema, type Curriculum, type CurriculumSkill } from "./schema";

export class CurriculumValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid curriculum (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n- ${issues.join("\n- ")}`);
    this.name = "CurriculumValidationError";
  }
}

const levelIndex = (cefr: string) => CEFR_LEVELS.indexOf(cefr as (typeof CEFR_LEVELS)[number]);

const STRATEGY_FOR_TYPE: Record<string, string[]> = {
  "multiple-choice": ["exact-choice"],
  "multiple-choice-context": ["exact-choice"],
  "fill-blank": ["normalized-text"],
  "contextual-verb": ["normalized-text"],
  "sentence-correction": ["normalized-text"],
  "sentence-transformation": ["normalized-text"],
  "sentence-construction": ["ordered-words"],
  "short-writing": ["limited-rubric", "ai-writing"],
};

function sortedWords(value: string): string {
  return normalizeAnswer(value).split(" ").filter(Boolean).sort().join(" ");
}

function checkSkill(skill: CurriculumSkill, issues: string[]): void {
  const at = (qid: string) => `${skill.id}/${qid}`;

  const ids = new Set<string>();
  for (const q of skill.questions) {
    if (ids.has(q.id)) issues.push(`${skill.id}: duplicate question id "${q.id}"`);
    ids.add(q.id);
  }
  if (new Set(skill.questions.map((q) => q.type)).size !== skill.questions.length) {
    issues.push(`${skill.id}: each exercise type must appear exactly once`);
  }

  for (const q of skill.questions) {
    if (!STRATEGY_FOR_TYPE[q.type]?.includes(q.strategy)) {
      issues.push(`${at(q.id)}: strategy "${q.strategy}" is not supported for exercise type "${q.type}"`);
    }

    if (q.strategy === "exact-choice") {
      const optionIds = new Set(q.options?.map((o) => o.id));
      if (!q.options) issues.push(`${at(q.id)}: choice question has no options`);
      if (optionIds.size !== (q.options?.length ?? 0)) issues.push(`${at(q.id)}: duplicate option ids`);
      if (q.acceptedAnswers.length === 0) issues.push(`${at(q.id)}: missing answer key`);
      if (q.acceptedAnswers.length > 1) issues.push(`${at(q.id)}: multiple choice needs exactly one correct option`);
      for (const a of q.acceptedAnswers) {
        if (!optionIds.has(a)) issues.push(`${at(q.id)}: answer key "${a}" is not one of the options`);
      }
    } else if (q.strategy !== "limited-rubric" && q.strategy !== "ai-writing") {
      if (q.acceptedAnswers.length === 0) issues.push(`${at(q.id)}: missing answer key`);
    }

    if (q.strategy === "ordered-words") {
      if (!q.tiles) {
        issues.push(`${at(q.id)}: sentence construction needs tiles`);
      } else {
        const tiles = sortedWords(q.tiles.join(" "));
        for (const a of q.acceptedAnswers) {
          if (sortedWords(a) !== tiles) issues.push(`${at(q.id)}: accepted answer "${a}" does not use exactly the tiles`);
        }
      }
    }

    if (q.strategy === "ai-writing" && !q.writingCriteria) {
      issues.push(`${at(q.id)}: ai-writing question needs writingCriteria`);
    }
  }
}

/**
 * Validates curriculum data: schema shape plus cross-checks a schema can't express (duplicate IDs,
 * broken or cyclic prerequisites, missing answer keys, unsupported exercise/strategy pairings).
 * Throws CurriculumValidationError listing every problem found.
 */
export function validateCurriculum(raw: unknown): Curriculum {
  const parsed = curriculumSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CurriculumValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const curriculum = parsed.data;
  const issues: string[] = [];

  const byId = new Map<string, CurriculumSkill>();
  const slugs = new Set<string>();
  for (const skill of curriculum.skills) {
    if (byId.has(skill.id)) issues.push(`duplicate skill id "${skill.id}"`);
    byId.set(skill.id, skill);
    if (slugs.has(skill.slug)) issues.push(`duplicate skill slug "${skill.slug}"`);
    slugs.add(skill.slug);
  }

  for (const skill of curriculum.skills) {
    for (const pre of skill.prerequisites) {
      const target = byId.get(pre);
      if (pre === skill.id) issues.push(`${skill.id}: lists itself as a prerequisite`);
      else if (!target) issues.push(`${skill.id}: prerequisite "${pre}" does not exist`);
      else if (levelIndex(target.cefr) > levelIndex(skill.cefr)) {
        issues.push(`${skill.id} (${skill.cefr}): prerequisite "${pre}" is a higher level (${target.cefr})`);
      }
    }
    checkSkill(skill, issues);
  }

  const mark = new Map<string, 1 | 2>();
  const visit = (skillId: string, trail: string[]): void => {
    if (mark.get(skillId) === 2) return;
    if (mark.get(skillId) === 1) {
      issues.push(`prerequisite cycle: ${[...trail, skillId].join(" → ")}`);
      return;
    }
    mark.set(skillId, 1);
    for (const pre of byId.get(skillId)?.prerequisites ?? []) if (byId.has(pre)) visit(pre, [...trail, skillId]);
    mark.set(skillId, 2);
  };
  for (const skill of curriculum.skills) visit(skill.id, []);

  if (issues.length > 0) throw new CurriculumValidationError(issues);
  return curriculum;
}
