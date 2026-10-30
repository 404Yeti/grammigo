import { defineSkill, lessonBuilder } from "../author";

const NOTE =
  "Editorial placement informed by common CEFR-aligned course syllabi; not validated against a corpus. Needs educator review.";

const pastB = lessonBuilder("a2-past-simple", "Past simple");
pastB.mc({
  prompt: "Which sentence is correct?",
  options: [
    "I goed to school yesterday.",
    "I went to school yesterday.",
    "I did went to school yesterday.",
    "I go to school yesterday.",
  ],
  correct: 1,
  hints: ["“Yesterday” is a finished time.", "Go is irregular: go → went."],
  why: "Finished times need the past simple. Some verbs are irregular: go → went.",
});
pastB.fill({
  prompt: "We ___ (visit) our grandparents last Sunday.",
  answers: ["visited", "We visited our grandparents last Sunday"],
  hints: ["“Last Sunday” is finished.", "Regular verbs add -ed: visit → visited."],
  why: "Regular past simple verbs end in -ed: visited.",
});
pastB.mcCtx({
  prompt: "She ___ her keys yesterday.",
  options: ["losed", "lost", "lose", "has losed"],
  correct: 1,
  hints: ["Lose is an irregular verb.", "lose → lost."],
  why: "Lose is irregular: the past simple is lost, not losed.",
});
pastB.fix({
  source: "“He didn’t went to the party.”",
  answers: ["He didn't go to the party", "He did not go to the party"],
  hints: ["After “didn’t”, which form of the verb do we use?", "Use the base form: go."],
  why: "After did/didn’t, use the base verb: He didn’t go (not went).",
});
pastB.build({
  tiles: ["see", "I", "her", "yesterday", "did", "not"],
  answers: ["I did not see her yesterday", "I didn't see her yesterday"],
  hints: ["Start with I.", "Order: I, did, not, see, her, yesterday."],
  why: "Past negatives: subject + did not + base verb.",
});
pastB.verb({
  prompt: "A: “Where did you buy that?” B: “I ___ (buy) it in Paris last year.”",
  answers: ["bought", "I bought it in Paris last year"],
  hints: ["“Last year” is finished.", "Buy is irregular: buy → bought."],
  why: "Buy is irregular: the past simple is bought.",
});
pastB.rewrite({
  prompt: "Make the sentence a question.",
  source: "“They played tennis on Friday.”",
  answers: ["Did they play tennis on Friday"],
  hints: ["Start with did.", "After “did”, use the base verb: play."],
  why: "Past questions use did + subject + base verb.",
});
pastB.write({
  prompt: "Write two sentences about what you did yesterday.",
  criteria:
    "Two short sentences about finished actions yesterday, using correct past simple forms (regular -ed or common irregular verbs).",
  hints: ["For example: “I watched a film.”", "Try an irregular verb: went, saw, ate."],
  why: "Finished past actions use the past simple.",
});

const prepB = lessonBuilder("a2-prepositions-time", "Prepositions of time");
prepB.mc({
  prompt: "Which sentence is correct?",
  options: [
    "The class starts in 9 o’clock.",
    "The class starts at 9 o’clock.",
    "The class starts on 9 o’clock.",
    "The class starts at the 9 o’clock.",
  ],
  correct: 1,
  hints: ["It’s a clock time.", "Use “at” for clock times."],
  why: "Use at for clock times, on for days and dates, and in for months, years and parts of the day.",
});
prepB.fill({
  prompt: "My birthday is ___ June.",
  answers: ["in", "My birthday is in June"],
  hints: ["June is a month.", "Use “in” for months."],
  why: "Use in for months, years and seasons: in June, in 2024, in summer.",
});
prepB.mcCtx({
  prompt: "We usually have a party ___ New Year’s Eve.",
  options: ["at", "on", "in", "by"],
  correct: 1,
  hints: ["New Year’s Eve is a specific day.", "Use “on” with specific days."],
  why: "Use on with specific days and dates: on Monday, on New Year’s Eve.",
});
prepB.fix({
  source: "“I will see you in Monday.”",
  answers: ["I will see you on Monday"],
  hints: ["Monday is a day.", "Days take “on”."],
  why: "Days of the week take on: on Monday.",
});
prepB.build({
  tiles: ["noon", "The", "is", "Friday", "meeting", "at", "on"],
  answers: ["The meeting is on Friday at noon"],
  hints: ["Start with “The meeting”.", "Day first (on Friday), then time (at noon)."],
  why: "Use on with the day and at with the time: on Friday at noon.",
});
prepB.verb({
  prompt: "A: “When do you wake up?” B: “I wake up ___ 6:30.”",
  answers: ["at", "I wake up at 6:30"],
  hints: ["6:30 is a clock time.", "Use “at” for clock times."],
  why: "Clock times take at: at 6:30.",
});
prepB.rewrite({
  prompt: "Start the sentence with “On Mondays”.",
  source: "“The shop opens at 8 o’clock on Mondays.”",
  answers: ["On Mondays the shop opens at 8 o'clock", "On Mondays, the shop opens at 8 o'clock"],
  hints: ["Move “on Mondays” to the front.", "On Mondays the shop opens at 8 o’clock."],
  why: "Time phrases can move to the start without changing the preposition.",
});
prepB.write({
  prompt: "Write two sentences about your week. Use at, on and in.",
  criteria:
    "Two short sentences about the writer's week that use the prepositions at (clock time), on (day) and in (month/part of day) correctly.",
  hints: ["For example: “I start work at 9 o’clock.”", "Try “on Saturday” or “in the evening”."],
  why: "at + clock time, on + day/date, in + month/year/part of day.",
});

const compB = lessonBuilder("a2-comparatives", "Comparatives");
compB.mc({
  prompt: "Which sentence is correct?",
  options: [
    "This book is more cheap than that one.",
    "This book is cheaper than that one.",
    "This book is cheaper that that one.",
    "This book is more cheaper than that one.",
  ],
  correct: 1,
  hints: ["“Cheap” is a short adjective.", "Short adjectives add -er, then use “than”."],
  why: "Short adjectives take -er + than: cheaper than. Don’t add more as well.",
});
compB.fill({
  prompt: "My brother is ___ (tall) than me.",
  answers: ["taller", "My brother is taller than me"],
  hints: ["“Tall” is a short adjective.", "Add -er: tall → taller."],
  why: "One-syllable adjectives add -er in comparisons: taller.",
});
compB.mcCtx({
  prompt: "Mount Everest is the ___ mountain in the world.",
  options: ["higher", "highest", "most high", "more high"],
  correct: 1,
  hints: ["Everest is higher than all the others.", "For the top of a group, use the + -est."],
  why: "Use the + -est for the top of a group: the highest.",
});
compB.fix({
  source: "“She is more taller than her sister.”",
  answers: ["She is taller than her sister"],
  hints: ["Don’t use two comparative forms together.", "Use “taller”, not “more taller”."],
  why: "Use either -er or more, never both: taller (not more taller).",
});
compB.build({
  tiles: ["pizza", "This", "the", "is", "best", "in", "town"],
  answers: ["This is the best pizza in town"],
  hints: ["Start with “This is”.", "Order: This, is, the, best, pizza, in, town."],
  why: "Good has an irregular superlative: the best.",
});
compB.verb({
  prompt: "A: “Is the train fast?” B: “Yes, it is ___ (fast) than the bus.”",
  answers: ["faster", "it is faster than the bus"],
  hints: ["“Than” signals a comparison.", "Fast → faster."],
  why: "One-syllable adjectives add -er in comparisons: faster than.",
});
compB.rewrite({
  prompt: "Write one sentence with “taller than”.",
  source: "“Tom is 1.80 m. Sam is 1.70 m.”",
  answers: ["Tom is taller than Sam"],
  hints: ["Who is taller?", "Tom is taller than Sam."],
  why: "Compare with adjective + -er + than.",
});
compB.write({
  prompt: "Write two sentences comparing two things or people you know.",
  criteria:
    "Two short sentences using comparatives or superlatives correctly (taller than, more interesting than, the best, etc.).",
  hints: ["For example: “My phone is newer than my laptop.”", "Long adjectives use more: more expensive."],
  why: "Short adjectives: -er/-est. Longer adjectives: more/most.",
});

const quantB = lessonBuilder("a2-quantifiers", "some / any / much / many");
quantB.mc({
  prompt: "Which sentence is correct?",
  options: [
    "I don’t have some money.",
    "I don’t have any money.",
    "I don’t have many money.",
    "I don’t have a money.",
  ],
  correct: 1,
  hints: ["The sentence is negative.", "Negatives usually take “any”."],
  why: "Use any in negatives and questions; use some in positive statements and offers.",
});
quantB.fill({
  prompt: "There isn’t ___ milk in the fridge.",
  answers: ["any", "There isn't any milk in the fridge"],
  hints: ["“Isn’t” makes it negative.", "Negative sentence → any."],
  why: "Negative sentences take any: there isn’t any milk.",
});
quantB.mcCtx({
  prompt: "How ___ students are in your class?",
  options: ["much", "many", "some", "any"],
  correct: 1,
  hints: ["Can you count students?", "Countable nouns take “many”."],
  why: "Use many with countable nouns (students) and much with uncountable ones (money).",
});
quantB.fix({
  source: "“I have too many homework.”",
  answers: ["I have too much homework"],
  hints: ["Is “homework” countable?", "Homework is uncountable, so use “much”."],
  why: "Homework is uncountable: use much, not many.",
});
quantB.build({
  tiles: ["tea", "Would", "like", "you", "some"],
  answers: ["Would you like some tea"],
  hints: ["Start with “Would”.", "Order: Would, you, like, some, tea."],
  why: "Use some in offers: Would you like some tea?",
});
quantB.verb({
  prompt: "A: “Would you like ___ coffee?” B: “Yes, please.”",
  answers: ["some", "Would you like some coffee"],
  hints: ["This is an offer.", "Offers use “some”."],
  why: "Offers and requests use some: Would you like some coffee?",
});
quantB.rewrite({
  prompt: "Make the sentence negative.",
  source: "“There is some milk.”",
  answers: ["There isn't any milk", "There is not any milk", "There is no milk"],
  hints: ["Negative → “any” (or “no”).", "There isn’t any milk."],
  why: "In negatives, some changes to any.",
});
quantB.write({
  prompt: "Write two sentences about food in your kitchen. Use some, any, much or many.",
  criteria:
    "Two short sentences about food that use some, any, much or many correctly (any in negatives, many with countable nouns, much with uncountable).",
  hints: ["For example: “I have some rice.”", "Try a negative: “I don’t have any bread.”"],
  why: "some in positives, any in negatives/questions, many + countable, much + uncountable.",
});

export const A2_SKILLS = [
  defineSkill(
    {
      id: "a2-past-simple",
      title: "Past simple: finished events",
      cefr: "A2",
      mappingRationale: `The past simple with common irregular verbs is a typical elementary-level target. ${NOTE}`,
      topic: "Verb tenses",
      subtopic: "Past simple: regular and common irregular",
      objectives: ["Form regular and common irregular past verbs", "Use did/didn’t with the base verb", "Talk about finished events"],
      prerequisites: ["a1-present-simple"],
      difficulty: 2,
      estimatedMinutes: 6,
      explanation: {
        summary: "Use the past simple for finished actions. Regular verbs add -ed; irregular verbs change. Questions and negatives use did + base verb.",
        examples: [
          { text: "I visited my aunt yesterday." },
          { text: "She went home early.", note: "go → went (irregular)" },
          { text: "He didn’t go to the party.", note: "did not + base verb" },
        ],
      },
      commonMistakes: [
        { mistake: "I goed home.", correction: "I went home.", why: "Go is irregular." },
        { mistake: "She didn’t went.", correction: "She didn’t go.", why: "After didn’t use the base verb." },
      ],
      intro: "Hey, amigo! Let’s talk about things that already happened: the past simple.",
      homeReason: "The past simple is how we tell stories about finished events. 8 questions · about 6 min.",
      keywords: ["past simple", "past tense", "yesterday", "last week", "irregular verbs", "regular verbs", "ed endings", "did", "tense", "tenses", "past"],
    },
    pastB.finish(),
  ),
  defineSkill(
    {
      id: "a2-prepositions-time",
      title: "Prepositions of time: at, on, in",
      cefr: "A2",
      mappingRationale: `At/on/in with time expressions is a standard elementary preposition set. ${NOTE}`,
      topic: "Prepositions",
      subtopic: "at / on / in for time",
      objectives: ["Use at for clock times", "Use on for days and dates", "Use in for months, years and parts of the day"],
      prerequisites: [],
      difficulty: 2,
      estimatedMinutes: 6,
      explanation: {
        summary: "at = clock times; on = days and dates; in = months, years, seasons and parts of the day.",
        examples: [
          { text: "The class starts at 9 o’clock." },
          { text: "See you on Monday." },
          { text: "My birthday is in June.", note: "Also: in the morning." },
        ],
      },
      commonMistakes: [
        { mistake: "in Monday", correction: "on Monday", why: "Days take on." },
        { mistake: "on 6 o’clock", correction: "at 6 o’clock", why: "Clock times take at." },
      ],
      intro: "Hey, amigo! At, on or in? Let’s make time prepositions feel easy.",
      homeReason: "At, on and in cause lots of mix-ups. 8 questions · about 6 min.",
      keywords: ["preposition", "prepositions", "prepositions of time", "at on in", "in on at", "time words", "on monday", "in june"],
    },
    prepB.finish(),
  ),
  defineSkill(
    {
      id: "a2-comparatives",
      title: "Comparatives and superlatives",
      cefr: "A2",
      mappingRationale: `Comparatives and superlatives are a standard elementary adjective topic. ${NOTE}`,
      topic: "Adjectives & adverbs",
      subtopic: "Comparatives and superlatives",
      objectives: ["Use -er/-est with short adjectives", "Use more/most with longer adjectives", "Avoid double comparatives"],
      prerequisites: ["a1-be-present"],
      difficulty: 2,
      estimatedMinutes: 6,
      explanation: {
        summary: "Short adjectives add -er/-est; longer adjectives use more/most. Good and bad are irregular.",
        examples: [
          { text: "This book is cheaper than that one." },
          { text: "She is the tallest in the class." },
          { text: "This is the best pizza in town.", note: "good → better → best" },
        ],
      },
      commonMistakes: [
        { mistake: "more taller", correction: "taller", why: "Use -er or more, not both." },
        { mistake: "more cheap", correction: "cheaper", why: "Short adjectives take -er." },
      ],
      intro: "Hey, amigo! Bigger, better, the best: let’s compare things.",
      homeReason: "Comparing things is a daily skill. 8 questions · about 6 min.",
      keywords: ["comparative", "comparatives", "superlative", "superlatives", "than", "more than", "adjectives", "compare", "better", "best"],
    },
    compB.finish(),
  ),
  defineSkill(
    {
      id: "a2-quantifiers",
      title: "some, any, much and many",
      cefr: "A2",
      mappingRationale: `Countable/uncountable quantifiers (some, any, much, many) are a standard elementary target. ${NOTE}`,
      topic: "Nouns & articles",
      subtopic: "some / any / much / many",
      objectives: ["Choose some or any", "Choose much or many", "Tell countable from uncountable nouns"],
      prerequisites: ["a1-articles"],
      difficulty: 2,
      estimatedMinutes: 6,
      explanation: {
        summary: "some = positive statements and offers; any = negatives and questions. many + countable; much + uncountable.",
        examples: [
          { text: "I have some apples." },
          { text: "I don’t have any money." },
          { text: "How many students are there? How much milk do we need?" },
        ],
      },
      commonMistakes: [
        { mistake: "too many homework", correction: "too much homework", why: "Homework is uncountable." },
        { mistake: "I don’t have some money.", correction: "I don’t have any money.", why: "Negatives take any." },
      ],
      intro: "Hey, amigo! Some, any, much, many: let’s count the things we can count.",
      homeReason: "Quantity words trip up lots of learners. 8 questions · about 6 min.",
      keywords: ["some", "any", "much", "many", "countable", "uncountable", "quantifiers", "quantity", "how much", "how many"],
    },
    quantB.finish(),
  ),
];
