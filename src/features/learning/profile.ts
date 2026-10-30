import { CEFR_LEVELS, type CefrLevel, type CurriculumSkill } from "@/curriculum/schema";
import { DEFAULT_MASTERY_CONFIG, type MasteryConfig, type SkillMastery } from "./mastery";

export type ProfileBucket = "strength" | "weakness" | "in_progress" | "unassessed";

export interface ProfileEntry {
  skillId: string;
  title: string;
  cefr: CefrLevel;
  topic: string;
  bucket: ProfileBucket;
  mastery: SkillMastery;
  isGoal: boolean;
  /** A weakness at a lower level than one of the learner's strengths (e.g. B2 strength, A2 gap). */
  gapBelowStrengths: boolean;
  /** Short sentence explaining why the skill is in this bucket. */
  note: string;
}

export interface LearningProfile {
  generatedAt: number;
  entries: ProfileEntry[];
  strengths: ProfileEntry[];
  weaknesses: ProfileEntry[];
  inProgress: ProfileEntry[];
  unassessed: ProfileEntry[];
  goalSkillIds: string[];
  /** The highest level at which a strength was observed. Informational only, never a CEFR level. */
  highestStrengthLevel: CefrLevel | null;
  /** True when strengths and weaknesses sit at different levels. */
  mixedLevel: boolean;
  headline: string;
  caveat: string;
}

export const PROFILE_CAVEAT =
  "This is a starting picture from a short check and your lessons, not a CEFR level. It will sharpen as you practice.";

const levelIdx = (l: CefrLevel) => CEFR_LEVELS.indexOf(l);

export function bucketFor(m: SkillMastery, config: MasteryConfig = DEFAULT_MASTERY_CONFIG): ProfileBucket {
  if (m.status === "not_assessed" || m.score === null) return "unassessed";
  if (m.status === "needs_practice") return "weakness";
  if (m.score >= config.likelyStrengthAt) return "strength";
  return "in_progress";
}

function noteFor(bucket: ProfileBucket, m: SkillMastery): string {
  const early = m.provisional ? " (early read: only a little evidence so far)" : "";
  switch (bucket) {
    case "strength":
      return `Answered mostly on your own${early}.`;
    case "weakness":
      return `Needed help or missed answers${early}.`;
    case "in_progress":
      return `Some evidence, not enough to call it${early}.`;
    case "unassessed":
      return "Not checked yet. That doesn’t mean it’s a weakness.";
  }
}

/**
 * Builds a provisional skill profile from mastery estimates plus the learner's stated goals.
 * Deterministic. It reports strengths, weaknesses and unassessed areas; it never assigns a CEFR level.
 */
export function buildProfile(input: {
  skills: readonly CurriculumSkill[];
  mastery: ReadonlyMap<string, SkillMastery>;
  goalSkillIds: readonly string[];
  now: number;
  config?: MasteryConfig;
}): LearningProfile {
  const { skills, mastery, goalSkillIds, now } = input;
  const config = input.config ?? DEFAULT_MASTERY_CONFIG;
  const goalSet = new Set(goalSkillIds);

  const base = skills.map((skill) => {
    const m = mastery.get(skill.id)!;
    return { skill, m, bucket: bucketFor(m, config) };
  });

  const strengthLevels = base.filter((b) => b.bucket === "strength").map((b) => levelIdx(b.skill.cefr));
  const maxStrength = strengthLevels.length > 0 ? Math.max(...strengthLevels) : -1;

  const entries: ProfileEntry[] = base.map(({ skill, m, bucket }) => ({
    skillId: skill.id,
    title: skill.title,
    cefr: skill.cefr,
    topic: skill.topic,
    bucket,
    mastery: m,
    isGoal: goalSet.has(skill.id),
    gapBelowStrengths: bucket === "weakness" && levelIdx(skill.cefr) < maxStrength,
    note: noteFor(bucket, m),
  }));

  const pick = (b: ProfileBucket) => entries.filter((e) => e.bucket === b);
  const strengths = pick("strength");
  const weaknesses = pick("weakness");
  const inProgress = pick("in_progress");
  const unassessed = pick("unassessed");
  const assessed = entries.length - unassessed.length;

  const headline =
    assessed === 0
      ? "We don’t have evidence about your grammar yet, so we’ll start gently."
      : `An early picture: ${strengths.length} likely ${strengths.length === 1 ? "strength" : "strengths"}, ${weaknesses.length} ${weaknesses.length === 1 ? "area" : "areas"} to work on, ${unassessed.length} not checked yet.`;

  return {
    generatedAt: now,
    entries,
    strengths,
    weaknesses,
    inProgress,
    unassessed,
    goalSkillIds: [...goalSkillIds],
    highestStrengthLevel: maxStrength >= 0 ? CEFR_LEVELS[maxStrength] : null,
    mixedLevel: weaknesses.some((w) => w.gapBelowStrengths),
    headline,
    caveat: PROFILE_CAVEAT,
  };
}
