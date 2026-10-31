import { guidedPilotSchema, GUIDED_SKILL_ID, type GuidedPilot } from "./schema";

/**
 * Pilot: Past simple vs Present perfect, as a CONVERSATION. Migo asks a question a person would
 * really ask; the learner answers in their own words. Nobody is asked to write a wrong sentence:
 * the Notice step only appears if the learner's own answer contains a target-skill mistake.
 *
 * All wording is authored and flagged for educator review. Rungs 1 and 2 never name the target
 * tense or give the target form (a test enforces it).
 */
const ITEMS_RAW = [
  {
    id: "ppps-main",
    skillId: GUIDED_SKILL_ID,
    kind: "main",
    frame: "finished",
    situation: "Migo is curious about your evening.",
    question: "What did you do yesterday evening?",
    speakable: "What did you do yesterday evening? Tell me about one thing.",
    answerHint: "Answer in one or two sentences, in your own words.",
    modelAnswers: ["I watched a film with my sister.", "I went for a walk after dinner."],
    categories: ["pp_with_finished_time", "participle_form"],
    wrongSamples: {
      pp_with_finished_time: ["I have watched a film yesterday evening.", "Yesterday evening I have gone to the cinema."],
      participle_form: ["I have went to the gym.", "I have saw a good film."],
    },
    contentStatus: "needs-educator-review",
  },
  {
    id: "ppps-transfer-finished",
    skillId: GUIDED_SKILL_ID,
    kind: "transfer",
    frame: "finished",
    situation: "Migo is curious about your last holiday.",
    question: "Where did you go on your last holiday?",
    speakable: "Where did you go on your last holiday?",
    answerHint: "Answer in one or two sentences, in your own words.",
    modelAnswers: ["I went to the coast last summer.", "I visited my cousins in Portugal."],
    categories: ["pp_with_finished_time", "participle_form"],
    wrongSamples: {
      pp_with_finished_time: ["I have gone to Spain last summer.", "We have travelled to Greece in 2022."],
      participle_form: ["I have went to the beach.", "We have took a train to the coast."],
    },
    contentStatus: "needs-educator-review",
  },
  {
    id: "ppps-transfer-unfinished",
    skillId: GUIDED_SKILL_ID,
    kind: "transfer",
    frame: "unfinished",
    situation: "Migo wants to know about your English.",
    question: "How long have you been learning English?",
    speakable: "How long have you been learning English?",
    answerHint: "Answer in one or two sentences, in your own words.",
    modelAnswers: ["I’ve been learning English for three years.", "I’ve studied English since 2022."],
    categories: ["since_for_confusion", "since_without_perfect", "pp_with_finished_time", "participle_form"],
    wrongSamples: {
      since_for_confusion: ["I have studied English since three years.", "I’m learning English for 2020."],
      since_without_perfect: ["I learn English since 2020.", "I am studying English since last year."],
      pp_with_finished_time: ["I have learned English two years ago."],
      participle_form: ["I have began learning English."],
    },
    contentStatus: "needs-educator-review",
  },
  {
    id: "ppps-experience",
    skillId: GUIDED_SKILL_ID,
    kind: "transfer",
    frame: "experience",
    situation: "Migo is curious about food.",
    question: "Have you ever tried a food you didn’t like?",
    speakable: "Have you ever tried a food you didn’t like?",
    answerHint: "Answer in one or two sentences, in your own words.",
    modelAnswers: ["Yes, I tried durian once and I didn’t like it.", "No, I’ve never tried anything I didn’t like."],
    categories: ["pp_with_finished_time", "participle_form"],
    wrongSamples: {
      pp_with_finished_time: ["Yes, I have tried durian last year.", "I have tasted it two weeks ago."],
      participle_form: ["I have ate snails.", "Yes, I have drank something horrible."],
    },
    contentStatus: "needs-educator-review",
  },
];

const CATEGORIES_RAW = [
  {
    id: "pp_with_finished_time",
    label: "Present perfect with a finished time",
    notice: "Read your sentence again with “{marker}” in mind. Does the verb fit?",
    hint2: "“{marker}” is a finished time. Which tense do we use for finished times?",
    hint3: "Finished time → past simple. Compare: “She called me last night.” Now try yours.",
    reason: "“{marker}” names a finished time, so we use the past simple. The present perfect connects the past to now, so it doesn’t go with a finished time.",
  },
  {
    id: "participle_form",
    label: "Verb form after have / has",
    notice: "Take another look at the verb after “{aux}”.",
    hint2: "After “have” or “has” we use a special form of the verb, and it isn’t always the same as the simple past.",
    hint3: "Compare: {exBase} → {exPast} → {exPart}. We say “I have {exPart}”, not “I have {exPast}”. Now try yours.",
    reason: "After “have” or “has” we use the past participle: “have {participle}”, not “have {verb}”.",
  },
  {
    id: "since_without_perfect",
    label: "since without the present perfect",
    notice: "Look at the verb that goes with “since”.",
    hint2: "“Since” links a starting point in the past to now. Which tense links the past to now?",
    hint3: "Starting point + now → present perfect. Compare: “She has worked here since 2020.” Now try yours.",
    reason: "“Since” gives a starting point, and the situation continues now, so we use the present perfect: “I have lived here since 2018”.",
  },
  {
    id: "since_for_confusion",
    label: "for and since",
    notice: "Check the word in front of your time expression.",
    hint2: "We use “for” with how long something lasts, and “since” with when it started.",
    hint3: "for + how long (“for three years”). since + when it started (“since 2020”). Now try yours.",
    reason: "Use “for” with a length of time (three years) and “since” with a starting point (2018). Both go with the present perfect.",
  },
];

export const GUIDED_PILOT: GuidedPilot = guidedPilotSchema.parse({
  skillId: GUIDED_SKILL_ID,
  categories: CATEGORIES_RAW,
  items: ITEMS_RAW,
  transferPlan: {
    afterError: ["ppps-transfer-finished"],
    afterFirstTry: ["ppps-transfer-unfinished"],
    alternate: ["ppps-experience"],
  },
});

export const getGuidedItem = (id: string) => GUIDED_PILOT.items.find((i) => i.id === id);
export const getGuidedCategory = (id: string) => GUIDED_PILOT.categories.find((c) => c.id === id);
