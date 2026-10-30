import type { ExerciseType, Question } from "@/types/lesson";
import type { CurriculumSkill } from "./schema";

/**
 * Authoring helpers: build the fixed eight-exercise lesson from compact definitions.
 * They produce plain Question data; nothing here is UI. Calls must be made in this order:
 * mc, fill, mcCtx, fix, build, verb, rewrite, write.
 */

interface Base {
  hints: [string, string];
  /** The rule, in one or two sentences. Shown as the explanation and after a wrong answer. */
  why: string;
  migo?: string;
  difficulty?: 1 | 2 | 3;
}

const PRAISE = [
  "Exactly! You’re getting the hang of this.",
  "Spot on!",
  "Yes, that’s the rule!",
  "Sharp eyes!",
  "Nicely built!",
  "That’s it!",
  "Great rewrite!",
  "Nice writing!",
];

const MIGO: Record<ExerciseType, string> = {
  "multiple-choice": "Take your time. Read each one once.",
  "fill-blank": "Think about the words around the gap.",
  "multiple-choice-context": "Use the rest of the sentence as a clue.",
  "sentence-correction": "Look closely. One thing is off.",
  "sentence-construction": "Start with who, then the verb.",
  "contextual-verb": "Read the whole conversation first.",
  "sentence-transformation": "Keep the meaning, change the form.",
  "short-writing": "Short and simple is perfect. No pressure on length.",
};

const TAG: Record<ExerciseType, string> = {
  "multiple-choice": "Recognize",
  "fill-blank": "Use",
  "multiple-choice-context": "Choose",
  "sentence-correction": "Correction",
  "sentence-construction": "Sentence building",
  "contextual-verb": "In context",
  "sentence-transformation": "Rewrite",
  "short-writing": "Writing",
};

const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0];
const clip = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

export function lessonBuilder(skillId: string, label: string) {
  const questions: Question[] = [];

  function make(
    type: ExerciseType,
    strategy: Question["strategy"],
    evidence: Question["evidence"],
    difficulty: 1 | 2 | 3,
    f: Base & Partial<Question> & { prompt: string; acceptedAnswers: string[]; displayAnswer: string },
  ): Question {
    const i = questions.length;
    const q: Question = {
      id: `q${i + 1}`,
      reviewTitle: clip(f.source ? `${f.prompt.replace(/\.$/, "")}: ${f.source}` : f.prompt),
      skillId,
      skillLabel: `${label} · ${TAG[type]}`,
      type,
      evidence,
      difficulty: f.difficulty ?? difficulty,
      strategy,
      prompt: f.prompt,
      source: f.source,
      options: f.options,
      tiles: f.tiles,
      acceptedAnswers: f.acceptedAnswers,
      displayAnswer: f.displayAnswer,
      helper: f.helper,
      placeholder: f.placeholder ?? (f.options || f.tiles ? undefined : "Type your answer…"),
      hints: f.hints,
      explanation: f.why,
      migoLine: f.migo ?? MIGO[type],
      praise: PRAISE[i],
      praiseBody: firstSentence(f.why),
      nudge: { title: "Not quite.", body: firstSentence(f.why) },
      maxAttempts: type === "multiple-choice" || type === "multiple-choice-context" ? 2 : 3,
      writingCriteria: f.writingCriteria,
    };
    questions.push(q);
    return q;
  }

  const choice = (type: "multiple-choice" | "multiple-choice-context", diff: 1 | 2) =>
    (f: Base & { prompt: string; options: [string, string, string, string]; correct: number }) =>
      make(type, "exact-choice", "recognition", diff, {
        ...f,
        options: f.options.map((label, i) => ({ id: "abcd"[i], label })),
        acceptedAnswers: ["abcd"[f.correct]],
        displayAnswer: f.options[f.correct],
      });

  return {
    mc: choice("multiple-choice", 1),
    mcCtx: choice("multiple-choice-context", 2),
    fill: (f: Base & { prompt: string; answers: string[] }) =>
      make("fill-blank", "normalized-text", "construction", 1, {
        ...f,
        acceptedAnswers: f.answers,
        displayAnswer: f.answers[0],
        helper: "One or two words",
      }),
    fix: (f: Base & { source: string; answers: string[]; display?: string }) =>
      make("sentence-correction", "normalized-text", "production", 2, {
        ...f,
        prompt: "Find the mistake and rewrite the sentence.",
        acceptedAnswers: f.answers,
        displayAnswer: f.display ?? `${f.answers[0]}.`,
      }),
    build: (f: Base & { tiles: string[]; answers: string[] }) =>
      make("sentence-construction", "ordered-words", "construction", 2, {
        ...f,
        prompt: "Put the words in order to make a correct sentence.",
        acceptedAnswers: f.answers,
        displayAnswer: `${f.answers[0]}.`,
        helper: "Tap a word to add or remove it. You can also type the sentence instead.",
      }),
    verb: (f: Base & { prompt: string; answers: string[] }) =>
      make("contextual-verb", "normalized-text", "construction", 2, {
        ...f,
        acceptedAnswers: f.answers,
        displayAnswer: f.answers[0],
        helper: "One or two words",
      }),
    rewrite: (f: Base & { prompt: string; source: string; answers: string[] }) =>
      make("sentence-transformation", "normalized-text", "production", 2, {
        ...f,
        acceptedAnswers: f.answers,
        displayAnswer: `${f.answers[0]}.`,
      }),
    write: (f: Base & { prompt: string; criteria: string }) =>
      make("short-writing", "ai-writing", "production", 3, {
        ...f,
        acceptedAnswers: [],
        displayAnswer: f.criteria,
        writingCriteria: f.criteria,
      }),
    finish(): Question[] {
      if (questions.length !== 8) throw new Error(`${skillId}: expected 8 questions, got ${questions.length}`);
      return questions;
    },
  };
}

type SkillMeta = Omit<CurriculumSkill, "slug" | "contentStatus" | "questions" | "review"> & {
  review?: CurriculumSkill["review"];
};

/** Every skill authored in-house starts as "needs-educator-review". */
export function defineSkill(meta: SkillMeta, questions: Question[]): CurriculumSkill {
  return {
    ...meta,
    slug: meta.id,
    review: meta.review ?? {
      strengthText: `You handled ${meta.subtopic.toLowerCase()} without help.`,
      practiceText: meta.commonMistakes[0]
        ? `Watch out: “${meta.commonMistakes[0].mistake}” should be “${meta.commonMistakes[0].correction}”.`
        : `Review ${meta.subtopic.toLowerCase()}.`,
    },
    contentStatus: "needs-educator-review",
    questions,
  };
}
