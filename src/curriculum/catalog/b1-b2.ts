import { presentPerfectVsPastSimple as legacy } from "@/data/lessons/present-perfect-vs-past-simple";
import { defineSkill, lessonBuilder } from "../author";
import type { CurriculumSkill } from "../schema";

const NOTE =
  "Editorial placement informed by common CEFR-aligned course syllabi; not validated against a corpus. Needs educator review.";

/**
 * Migrated from v0.1 without changing the lesson id, question ids or content, so saved sessions
 * keep working. Question skillIds stay as the v0.1 sub-skill ids (they carry the review copy).
 */
const presentPerfectVsPastSimple: CurriculumSkill = {
  id: legacy.id,
  title: legacy.title,
  slug: legacy.id,
  cefr: "B1",
  mappingRationale: `Contrasting the present perfect with the past simple is a classic intermediate target. ${NOTE}`,
  topic: "Verb tenses",
  subtopic: "Present perfect vs. past simple",
  objectives: legacy.objectives,
  prerequisites: ["a2-past-simple"],
  difficulty: 3,
  estimatedMinutes: legacy.minutes,
  explanation: {
    summary:
      "Use the past simple for finished times (yesterday, in 2020, ago). Use the present perfect (have/has + past participle) when the time connects to now (since, for, so far, ever).",
    examples: [
      { text: "I saw that film yesterday.", note: "Finished time → past simple." },
      { text: "I have lived here since 2018.", note: "Still true now → present perfect." },
      { text: "He left ten minutes ago.", note: "“Ago” marks a finished time." },
    ],
  },
  commonMistakes: [
    { mistake: "I have seen that film yesterday.", correction: "I saw that film yesterday.", why: "Yesterday is finished." },
    { mistake: "She works here since 2021.", correction: "She has worked here since 2021.", why: "Since + a start point needs the present perfect." },
  ],
  intro: legacy.intro,
  homeReason: legacy.homeReason,
  keywords: [
    "present perfect", "past simple", "since", "for", "have done", "have been", "tenses", "tense", "ago", "yesterday", "already", "yet", "mix up tenses",
  ],
  review: {
    strengthText: "You told the present perfect and past simple apart without help.",
    practiceText: "Finished times (yesterday, ago, in 2020) take the past simple; “since/for” with now takes the present perfect.",
  },
  contentStatus: "needs-educator-review",
  questions: legacy.questions,
};

const firstB = lessonBuilder("b1-first-conditional", "First conditional");
firstB.mc({
  prompt: "Which sentence is a first conditional?",
  options: [
    "If I will see him, I tell him.",
    "If I see him, I will tell him.",
    "If I saw him, I would tell him.",
    "If I had seen him, I would have told him.",
  ],
  correct: 1,
  hints: ["First conditionals talk about real future possibilities.", "If + present simple, then will + base verb."],
  why: "First conditional: if + present simple, will + base verb, for real future possibilities.",
});
firstB.fill({
  prompt: "If it rains tomorrow, we ___ (stay) at home.",
  answers: ["will stay", "we will stay", "If it rains tomorrow we will stay at home"],
  hints: ["It’s a real future possibility.", "Use will + the base verb."],
  why: "The result clause uses will + base verb: we will stay.",
});
firstB.mcCtx({
  prompt: "If you ___ hard, you will pass the exam.",
  options: ["study", "will study", "studied", "would study"],
  correct: 0,
  hints: ["Look at “will pass” in the result.", "The if-clause uses the present simple."],
  why: "After if in a first conditional, use the present simple, not will.",
});
firstB.fix({
  source: "“If she will come, I will be happy.”",
  answers: ["If she comes I will be happy"],
  hints: ["Look at the verb after “If”.", "Use the present simple after if: she comes."],
  why: "Don’t use will in the if-clause: If she comes, I will be happy.",
});
firstB.build({
  tiles: ["catch", "If", "leave", "we", "now", "will", "the", "train", "we"],
  answers: ["If we leave now we will catch the train", "We will catch the train if we leave now"],
  hints: ["Start with “If”.", "Order: If, we, leave, now, we, will, catch, the, train."],
  why: "If + present simple, then subject + will + base verb.",
});
firstB.verb({
  prompt: "A: “What will you do if it is sunny?” B: “If it ___ (be) sunny, I will go to the beach.”",
  answers: ["is", "If it is sunny I will go to the beach"],
  hints: ["The if-clause is present simple.", "It + is."],
  why: "The if-clause uses the present simple: If it is sunny.",
});
firstB.rewrite({
  prompt: "Rewrite with “If”.",
  source: "“Study hard or you will fail the test.”",
  answers: [
    "If you don't study hard you will fail the test",
    "If you do not study hard you will fail the test",
  ],
  hints: ["Start with “If you…”.", "Use a negative: don’t study."],
  why: "“Or” warnings become if + negative present simple, then will.",
});
firstB.write({
  prompt: "Write two sentences about your plans for this weekend. Use “if” and “will”.",
  criteria:
    "Two sentences, each a first conditional (if + present simple, will + base verb) about plausible future events.",
  hints: ["For example: “If the weather is good, I will go for a walk.”", "Don’t put will after if."],
  why: "First conditional: if + present simple, will + base verb.",
});

const passB = lessonBuilder("b1-passive-voice", "Passive voice");
passB.mc({
  prompt: "Which sentence is passive?",
  options: [
    "The cake was baked by my mother.",
    "My mother baked the cake.",
    "My mother is baking the cake.",
    "My mother has baked the cake.",
  ],
  correct: 0,
  hints: ["In a passive sentence, the subject receives the action.", "Look for be + past participle."],
  why: "Passive = be + past participle; the subject receives the action.",
});
passB.fill({
  prompt: "English ___ (speak) in many countries.",
  answers: ["is spoken", "English is spoken in many countries"],
  hints: ["Present simple passive: is/are + past participle.", "Speak → spoken."],
  why: "Present simple passive: is/are + past participle: is spoken.",
});
passB.mcCtx({
  prompt: "This bridge ___ in 1990.",
  options: ["built", "was built", "is built", "has built"],
  correct: 1,
  hints: ["“In 1990” is a finished time.", "Past simple passive: was/were + past participle."],
  why: "Past simple passive: was/were + past participle: was built.",
});
passB.fix({
  source: "“The window was broke by the children.”",
  answers: ["The window was broken by the children"],
  hints: ["After was, use the past participle.", "Break → broken."],
  why: "Passive needs the past participle: broken (not broke).",
});
passB.build({
  tiles: ["sent", "The", "were", "yesterday", "letters"],
  answers: ["The letters were sent yesterday", "Yesterday the letters were sent"],
  hints: ["Start with “The letters”.", "Order: The, letters, were, sent, yesterday."],
  why: "Past passive with a plural subject: were + past participle.",
});
passB.verb({
  prompt: "A: “Who wrote this book?” B: “It ___ (write) by Jane Austen in 1813.”",
  answers: ["was written", "It was written by Jane Austen in 1813"],
  hints: ["“In 1813” is a finished time.", "was + written."],
  why: "Past passive: was + past participle: was written.",
});
passB.rewrite({
  prompt: "Rewrite in the passive.",
  source: "“Someone stole my bike.”",
  answers: ["My bike was stolen", "My bike was stolen by someone"],
  hints: ["Start with “My bike”.", "was + stolen."],
  why: "The object becomes the subject: My bike was stolen.",
});
passB.write({
  prompt: "Write two sentences in the passive about things made or done at your school or workplace.",
  criteria:
    "Two sentences using the passive voice correctly (be + past participle), e.g. “The report is written every week.”",
  hints: ["For example: “Lunch is served at noon.”", "Past: “The room was cleaned yesterday.”"],
  why: "Passive = be + past participle.",
});

const condB = lessonBuilder("b2-second-third-conditionals", "Second & third conditionals");
condB.mc({
  prompt: "Which sentence is a second conditional?",
  options: [
    "If I won the lottery, I would travel the world.",
    "If I win the lottery, I will travel the world.",
    "If I had won the lottery, I would have travelled the world.",
    "If I would win the lottery, I travel the world.",
  ],
  correct: 0,
  hints: ["Second conditionals describe unreal or unlikely present/future situations.", "If + past simple, would + base verb."],
  why: "Second conditional: if + past simple, would + base verb, for unlikely or imaginary situations.",
});
condB.fill({
  prompt: "If I ___ (have) more time, I would learn Spanish.",
  answers: ["had"],
  hints: ["The situation is imaginary.", "Use the past simple after if."],
  why: "The if-clause of a second conditional uses the past simple: had.",
});
condB.mcCtx({
  prompt: "If she had studied harder, she ___ the exam.",
  options: ["would pass", "would have passed", "will pass", "passed"],
  correct: 1,
  hints: ["“Had studied” points to the unreal past.", "Third conditional result: would have + past participle."],
  why: "Third conditional: if + past perfect, would have + past participle.",
});
condB.fix({
  source: "“If I would know the answer, I would tell you.”",
  answers: ["If I knew the answer I would tell you"],
  hints: ["Look at the if-clause.", "Don’t use would after if: use the past simple."],
  why: "No would in the if-clause: If I knew the answer, I would tell you.",
});
condB.build({
  tiles: ["called", "If", "had", "known", "I", "would", "have", "you", "I"],
  answers: ["If I had known I would have called you", "I would have called you if I had known"],
  hints: ["Start with “If I had…”.", "Third conditional: had known, would have called."],
  why: "Third conditional: if + had + past participle, would have + past participle.",
});
condB.verb({
  prompt: "A: “Why didn’t you come?” B: “If I ___ (know) about the party, I would have come.”",
  answers: ["had known", "If I had known about the party I would have come"],
  hints: ["It’s about the unreal past.", "Past perfect: had + known."],
  why: "Third conditional if-clause: past perfect: had known.",
});
condB.rewrite({
  prompt: "Rewrite as a third conditional, beginning “If I…”.",
  source: "“I didn’t study, so I failed.”",
  answers: [
    "If I had studied I would not have failed",
    "If I had studied I wouldn't have failed",
    "If I had studied I would have passed",
  ],
  hints: ["Start with “If I had studied”.", "Result: would not have failed, or would have passed."],
  why: "Imagine the opposite of the past: if + had + participle, would have + participle.",
});
condB.write({
  prompt: "Write two sentences: one imaginary situation now (second conditional) and one regret about the past (third conditional).",
  criteria:
    "One second conditional (if + past simple, would + base verb) and one third conditional (if + past perfect, would have + past participle), both formed correctly.",
  hints: ["For example: “If I had a car, I would drive to work.”", "Past regret: “If I had left earlier, I would have caught the bus.”"],
  why: "Second = unreal now/future; third = unreal past.",
});

const repB = lessonBuilder("b2-reported-speech", "Reported speech");
repB.mc({
  prompt: "Which sentence correctly reports: “I am tired,” she said?",
  options: [
    "She said she was tired.",
    "She said she were tired.",
    "She said I was tired.",
    "She said she be tired.",
  ],
  correct: 0,
  hints: ["Reported speech usually moves one tense back.", "am → was, and I → she."],
  why: "In reported speech the tense usually moves back (am → was) and pronouns change (I → she).",
});
repB.fill({
  prompt: "“I live in Rome,” he said. → He said he ___ in Rome.",
  answers: ["lived", "He said he lived in Rome"],
  hints: ["Move the tense one step back.", "live → lived."],
  why: "Present simple becomes past simple in reported speech: live → lived.",
});
repB.mcCtx({
  prompt: "He said, “I will help you.” → He said he ___ help me.",
  options: ["would", "will", "is", "did"],
  correct: 0,
  hints: ["Will moves back one tense.", "will → would."],
  why: "In reported speech will becomes would.",
});
repB.fix({
  source: "“She said me that she was busy.”",
  answers: [
    "She told me that she was busy",
    "She told me she was busy",
    "She said that she was busy",
    "She said she was busy",
  ],
  hints: ["Look at “said me”.", "Use “told me” or just “said” without “me”."],
  why: "Say is not followed by a person: say (that…) or tell someone (that…).",
});
repB.build({
  tiles: ["ready", "He", "asked", "me", "if", "I", "was"],
  answers: ["He asked me if I was ready"],
  hints: ["Start with “He asked me”.", "Reported questions use if + normal word order."],
  why: "Reported yes/no questions use if + statement word order: He asked me if I was ready.",
});
repB.verb({
  prompt: "They said, “We are leaving tomorrow.” → They said they ___ (leave) the next day.",
  answers: ["were leaving", "They said they were leaving the next day"],
  hints: ["are leaving moves one tense back.", "was/were + leaving."],
  why: "Present continuous becomes past continuous: are leaving → were leaving.",
});
repB.rewrite({
  prompt: "Report what Tom said. Begin with “Tom said”.",
  source: "“I have finished my homework,” Tom said.",
  answers: ["Tom said he had finished his homework", "Tom said that he had finished his homework"],
  hints: ["Present perfect moves back to past perfect.", "have finished → had finished; my → his."],
  why: "Present perfect becomes past perfect; pronouns change: had finished his homework.",
});
repB.write({
  prompt: "Write two sentences reporting something someone told you recently.",
  criteria:
    "Two sentences in reported speech that use correct backshift and pronoun changes (e.g. “She said she was busy.”).",
  hints: ["For example: “My friend said he was tired.”", "Remember: said / told me + that."],
  why: "Reported speech moves tenses back and changes pronouns.",
});

export const B_SKILLS = [
  presentPerfectVsPastSimple,
  defineSkill(
    {
      id: "b1-first-conditional",
      title: "First conditional: real possibilities",
      cefr: "B1",
      mappingRationale: `The first conditional for real future possibilities is a standard pre-intermediate/intermediate target. ${NOTE}`,
      topic: "Conditionals",
      subtopic: "First conditional",
      objectives: ["Form if + present simple, will + base verb", "Avoid will in the if-clause", "Talk about real future possibilities"],
      prerequisites: ["a1-present-simple"],
      difficulty: 3,
      estimatedMinutes: 6,
      explanation: {
        summary: "For real future possibilities: if + present simple, will + base verb. Don’t use will after if.",
        examples: [
          { text: "If it rains, we will stay at home." },
          { text: "If you study, you will pass.", note: "Not: if you will study." },
          { text: "We will be late if we don’t hurry." },
        ],
      },
      commonMistakes: [
        { mistake: "If she will come, I will be happy.", correction: "If she comes, I will be happy.", why: "No will in the if-clause." },
      ],
      intro: "Hey, amigo! Let’s talk about real future possibilities: the first conditional.",
      homeReason: "If this happens, then that will happen: the first conditional. 8 questions · about 6 min.",
      keywords: ["first conditional", "conditional", "conditionals", "if", "if clause", "will", "future possibility", "if sentences"],
    },
    firstB.finish(),
  ),
  defineSkill(
    {
      id: "b1-passive-voice",
      title: "The passive: present and past",
      cefr: "B1",
      mappingRationale: `The passive in present and past simple is a standard intermediate target. ${NOTE}`,
      topic: "Voice",
      subtopic: "Passive: present and past simple",
      objectives: ["Form be + past participle", "Choose present or past passive", "Rewrite active sentences in the passive"],
      prerequisites: ["a2-past-simple"],
      difficulty: 3,
      estimatedMinutes: 7,
      explanation: {
        summary: "Passive = be + past participle. Use it when the action or the receiver matters more than who did it.",
        examples: [
          { text: "English is spoken in many countries." },
          { text: "The bridge was built in 1990." },
          { text: "My bike was stolen.", note: "We don’t say who did it." },
        ],
      },
      commonMistakes: [
        { mistake: "The window was broke.", correction: "The window was broken.", why: "Use the past participle." },
      ],
      intro: "Hey, amigo! Sometimes what happened matters more than who did it. Hello, passive voice!",
      homeReason: "The passive is everywhere in news and instructions. 8 questions · about 7 min.",
      keywords: ["passive", "passive voice", "was made", "is made", "past participle", "by", "active and passive", "voice"],
    },
    passB.finish(),
  ),
  defineSkill(
    {
      id: "b2-second-third-conditionals",
      title: "Second and third conditionals",
      cefr: "B2",
      mappingRationale: `Second and third conditionals for unreal situations are a common upper-intermediate target. ${NOTE}`,
      topic: "Conditionals",
      subtopic: "Second and third conditionals",
      objectives: ["Form second conditionals for unreal present/future", "Form third conditionals for the unreal past", "Avoid would in the if-clause"],
      prerequisites: ["b1-first-conditional", "a2-past-simple"],
      difficulty: 4,
      estimatedMinutes: 8,
      explanation: {
        summary: "Second: if + past simple, would + base verb (unlikely/imaginary). Third: if + past perfect, would have + past participle (unreal past).",
        examples: [
          { text: "If I won the lottery, I would travel the world." },
          { text: "If I had known, I would have called you.", note: "Unreal past." },
          { text: "If I knew, I would tell you.", note: "Not: if I would know." },
        ],
      },
      commonMistakes: [
        { mistake: "If I would know, I would tell you.", correction: "If I knew, I would tell you.", why: "No would in the if-clause." },
      ],
      intro: "Hey, amigo! Imagine if… Let’s practice unreal situations in the present and the past.",
      homeReason: "Imaginary situations and regrets: second and third conditionals. 8 questions · about 8 min.",
      keywords: ["second conditional", "third conditional", "conditional", "conditionals", "if i were", "would have", "unreal", "hypothetical", "regret", "if"],
    },
    condB.finish(),
  ),
  defineSkill(
    {
      id: "b2-reported-speech",
      title: "Reported speech",
      cefr: "B2",
      mappingRationale: `Reported speech with backshift is a typical upper-intermediate target. ${NOTE}`,
      topic: "Reporting",
      subtopic: "Reported speech",
      objectives: ["Move tenses back in reported speech", "Change pronouns and time words", "Report questions with if/whether"],
      prerequisites: ["a2-past-simple"],
      difficulty: 4,
      estimatedMinutes: 8,
      explanation: {
        summary: "When reporting what someone said, the tense usually moves one step back, and pronouns and time words change.",
        examples: [
          { text: "“I am tired.” → She said she was tired." },
          { text: "“I will help.” → He said he would help." },
          { text: "“Are you ready?” → He asked if I was ready.", note: "Statement word order." },
        ],
      },
      commonMistakes: [
        { mistake: "She said me that…", correction: "She told me that… / She said that…", why: "Say isn’t followed by a person." },
      ],
      intro: "Hey, amigo! Let’s learn to tell other people’s words: reported speech.",
      homeReason: "Telling what someone else said: reported speech. 8 questions · about 8 min.",
      keywords: ["reported speech", "indirect speech", "said", "told", "reporting", "backshift", "he said that", "she asked"],
    },
    repB.finish(),
  ),
];
