import { GrammarTag, type TagStyle } from "./GrammarTag";
import type { SkillMastery } from "@/features/learning/mastery";

const LABEL: Record<SkillMastery["status"], { text: string; style: TagStyle }> = {
  not_assessed: { text: "Not assessed", style: "neutral" },
  learning: { text: "Learning", style: "info" },
  needs_practice: { text: "Needs practice", style: "warning" },
  developing: { text: "Developing", style: "info" },
  strong: { text: "Strong", style: "success" },
};

/** Status chip. Text first; colour is supportive. "Not assessed" is never shown as weakness. */
export function MasteryBadge({ mastery }: { mastery: SkillMastery }) {
  const l = LABEL[mastery.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <GrammarTag style={l.style}>
        {l.text}
        {mastery.provisional && mastery.status !== "not_assessed" ? " · early read" : ""}
      </GrammarTag>
      {mastery.reviewDue && (mastery.status === "strong" || mastery.status === "developing") && (
        <GrammarTag style="brand">Review due</GrammarTag>
      )}
    </span>
  );
}
