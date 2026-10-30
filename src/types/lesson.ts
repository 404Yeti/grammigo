export type ExerciseType =
  | "multiple-choice"
  | "fill-blank"
  | "multiple-choice-context"
  | "sentence-correction"
  | "sentence-construction"
  | "contextual-verb"
  | "sentence-transformation"
  | "short-writing";

/** How an answer is judged. Closed-ended questions never need a network call. */
export type EvaluationStrategy =
  | "exact-choice"
  | "normalized-text"
  | "ordered-words"
  | "limited-rubric"
  /** Open writing: needs optional AI feedback; without it the answer is saved as unverified. */
  | "ai-writing";

/** The kind of learning evidence a question produces (for the future adaptive engine). */
export type EvidenceKind = "recognition" | "construction" | "production";

export type Difficulty = 1 | 2 | 3;

export interface ChoiceOption {
  id: string;
  label: string;
}

export interface Misconception {
  /** Raw learner answers (compared after normalization) that signal this specific error. */
  answers: string[];
  message: string;
}

export interface Question {
  id: string;
  /** Compact label for the review list. */
  reviewTitle: string;
  skillId: string;
  /** Short chip text shown above the prompt, e.g. "Present perfect · Recognize". */
  skillLabel: string;
  type: ExerciseType;
  evidence: EvidenceKind;
  difficulty: Difficulty;
  strategy: EvaluationStrategy;
  prompt: string;
  /** A quoted sentence the learner works on (correction / transformation). */
  source?: string;
  options?: ChoiceOption[];
  tiles?: string[];
  /** Option ids for choice questions; sentences/words for text questions. Empty for rubric. */
  acceptedAnswers: string[];
  /** Text shown as the model answer in review. */
  displayAnswer: string;
  helper?: string;
  placeholder?: string;
  /** Pre-authored hints, revealed one at a time. */
  hints: string[];
  explanation: string;
  /** Migo's line while the learner is answering. */
  migoLine: string;
  /** Headline on a correct answer. */
  praise: string;
  /** Short correct-answer body line. */
  praiseBody: string;
  /** Encouraging headline/body for a wrong answer. */
  nudge: { title: string; body: string };
  misconceptions?: Misconception[];
  maxAttempts: number;
  /** What a good answer must show; used only for optional AI writing feedback. */
  writingCriteria?: string;
}

export interface Skill {
  id: string;
  title: string;
  /** Review copy when the learner got this skill right unaided. */
  strengthText: string;
  /** Review copy when the learner needed help or missed it. */
  practiceText: string;
}

export interface Lesson {
  id: string;
  title: string;
  grammarFocus: string;
  minutes: number;
  intro: string;
  objectives: string[];
  /** Why the dashboard recommends this lesson before any history exists. */
  homeReason: string;
  questions: Question[];
}
