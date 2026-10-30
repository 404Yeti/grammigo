import { defineSkill, lessonBuilder } from "../author";

const RATIONALE_NOTE =
  "Editorial placement informed by common CEFR-aligned course syllabi; not validated against a corpus. Needs educator review.";

const beB = lessonBuilder("a1-be-present", "Present simple of be");
beB.mc({
  prompt: "Which sentence is correct?",
  options: ["She am a teacher.", "She is a teacher.", "She are a teacher.", "She be a teacher."],
  correct: 1,
  hints: ["“She” is one person: he, she or it.", "With he / she / it, use “is”."],
  why: "Use am with I, is with he/she/it, and are with you/we/they.",
});
beB.fill({
  prompt: "I ___ from Spain.",
  answers: ["am", "I am"],
  hints: ["Which form goes with “I”?", "It is a very short word: a-m."],
  why: "With “I” we always use am.",
});
beB.mcCtx({
  prompt: "My brothers ___ at school now.",
  options: ["is", "am", "are", "be"],
  correct: 2,
  hints: ["“My brothers” is more than one person.", "Plural subjects take “are”."],
  why: "Plural subjects (we, you, they, my brothers) take are.",
});
beB.fix({
  source: "“They is very happy.”",
  answers: ["They are very happy", "They're very happy"],
  hints: ["Look at the verb after “They”.", "“They” needs “are”."],
  why: "“They” is plural, so the verb is are, not is.",
});
beB.build({
  tiles: ["from", "My", "is", "Italy", "best", "friend"],
  answers: ["My best friend is from Italy"],
  hints: ["Start with who: My best friend.", "Order: My, best, friend, is, from, Italy."],
  why: "Subject + is/am/are + the rest: My best friend is from Italy.",
});
beB.verb({
  prompt: "A: “Are you tired?” B: “No, I ___ not tired.”",
  answers: ["am", "I am"],
  hints: ["Which form goes with “I”?", "It’s “am”, and then “not”."],
  why: "With I we use am; the negative is am not.",
});
beB.rewrite({
  prompt: "Make the sentence negative.",
  source: "“We are happy.”",
  answers: ["We are not happy", "We aren't happy", "We're not happy"],
  hints: ["Add “not” after the verb.", "We are not happy / We aren’t happy."],
  why: "For the negative of be, add not after am/is/are.",
});
beB.write({
  prompt: "Write two sentences about yourself using am, is or are.",
  criteria:
    "Two short sentences about the writer that correctly use am, is or are with the right subject (I am, he/she is, we/they are).",
  hints: ["For example: “I am a student.”", "You can also write about a friend: “She is my sister.”"],
  why: "Match the verb to the subject: I am, he/she/it is, you/we/they are.",
});

const artB = lessonBuilder("a1-articles", "Articles");
artB.mc({
  prompt: "Which sentence is correct?",
  options: ["She has a umbrella.", "She has an umbrella.", "She has umbrella.", "She has the umbrellas."],
  correct: 1,
  hints: ["Listen to the first sound of “umbrella”.", "It starts with a vowel sound, so use “an”."],
  why: "Use an before a vowel sound (an umbrella) and a before a consonant sound (a book).",
});
artB.fill({
  prompt: "I need ___ new phone.",
  answers: ["a", "I need a new phone"],
  hints: ["“Phone” is singular. Which article fits?", "“New” starts with a consonant sound."],
  why: "Use a before a singular countable noun when it starts with a consonant sound.",
});
artB.mcCtx({
  prompt: "I bought a jacket and a hat. ___ jacket was expensive.",
  options: ["The", "A", "An", "Some"],
  correct: 0,
  hints: ["Which jacket? The one we just mentioned.", "When it is already known, use “the”."],
  why: "Use the when both people know which one: here, the jacket already mentioned.",
});
artB.fix({
  source: "“She is an university student.”",
  answers: ["She is a university student"],
  hints: ["Say “university”. What is its first sound?", "It begins with a “yoo” sound, a consonant sound."],
  why: "University starts with a consonant sound (/j/), so we use a, not an.",
});
artB.build({
  tiles: ["star", "The", "is", "a", "sun"],
  answers: ["The sun is a star"],
  hints: ["Start with “The sun”.", "Order: The, sun, is, a, star."],
  why: "We say the sun (only one) and a star (one of many).",
});
artB.verb({
  prompt: "A: “What is that?” B: “It is ___ owl.”",
  answers: ["an", "It is an owl"],
  hints: ["Say “owl”. What kind of sound does it start with?", "A vowel sound needs “an”."],
  why: "Owl starts with a vowel sound, so we use an.",
});
artB.rewrite({
  prompt: "Add the missing article.",
  source: "“I want to be doctor.”",
  answers: ["I want to be a doctor"],
  hints: ["Jobs usually need an article.", "Use “a” before “doctor”."],
  why: "With a singular job title we use a/an: a doctor.",
});
artB.write({
  prompt: "Write two sentences about things in your bag. Use a, an or the.",
  criteria:
    "Two short sentences about objects, using a, an or the correctly (a before consonant sounds, an before vowel sounds, the for something already known).",
  hints: ["For example: “I have a pen and an apple.”", "Use “the” when you mention the same thing again."],
  why: "Use a/an for the first mention and the for something already known.",
});

const psB = lessonBuilder("a1-present-simple", "Present simple");
psB.mc({
  prompt: "Which sentence is correct?",
  options: [
    "He play football on Sundays.",
    "He plays football on Sundays.",
    "He playing football on Sundays.",
    "He does plays football on Sundays.",
  ],
  correct: 1,
  hints: ["“He” is one person.", "With he/she/it, add -s to the verb."],
  why: "With he, she and it, the present simple verb ends in -s: he plays.",
});
psB.fill({
  prompt: "My sister ___ (work) in a bank.",
  answers: ["works", "My sister works in a bank"],
  hints: ["“My sister” = she.", "Add -s: work → works."],
  why: "With he/she/it (and singular nouns) the verb takes -s: she works.",
});
psB.mcCtx({
  prompt: "___ you like coffee?",
  options: ["Does", "Do", "Are", "Is"],
  correct: 1,
  hints: ["Questions in the present simple use do or does.", "“You” goes with “do”."],
  why: "Use do with I/you/we/they, and does with he/she/it.",
});
psB.fix({
  source: "“She don’t like tea.”",
  answers: ["She doesn't like tea", "She does not like tea"],
  hints: ["Which helper goes with “she”?", "“Doesn’t” + the base verb."],
  why: "With he/she/it, the negative is doesn’t + base verb: she doesn’t like.",
});
psB.build({
  tiles: ["lunch", "They", "at", "usually", "eat", "noon"],
  answers: ["They usually eat lunch at noon", "Usually they eat lunch at noon"],
  hints: ["Start with who: They.", "The frequency word goes before the verb."],
  why: "Frequency words like usually go before the main verb: They usually eat.",
});
psB.verb({
  prompt: "A: “Does Tom live here?” B: “No, he ___ (live) in London.”",
  answers: ["lives", "he lives"],
  hints: ["“He” is one person.", "Add -s: live → lives."],
  why: "Statements with he/she/it take -s: he lives.",
});
psB.rewrite({
  prompt: "Make the sentence a question.",
  source: "“She speaks French.”",
  answers: ["Does she speak French"],
  hints: ["Start with does.", "After “does”, the verb loses its -s."],
  why: "Questions use does + subject + base verb: Does she speak French?",
});
psB.write({
  prompt: "Write two sentences about your daily routine in the present simple.",
  criteria:
    "Two short sentences about the writer's routine in the present simple, with correct verb forms (including -s for he/she/it if used).",
  hints: ["For example: “I wake up at seven.”", "Try one sentence with “usually” or “always”."],
  why: "For habits and routines, use the present simple.",
});

export const A1_SKILLS = [
  defineSkill(
    {
      id: "a1-be-present",
      title: "Present simple of “be”",
      cefr: "A1",
      mappingRationale: `Forms of be are among the first verb forms taught and are needed for almost every basic sentence. ${RATIONALE_NOTE}`,
      topic: "Verb forms",
      subtopic: "be: am / is / are",
      objectives: ["Choose am, is or are for each subject", "Make negative sentences with be", "Describe yourself and others"],
      prerequisites: [],
      difficulty: 1,
      estimatedMinutes: 5,
      explanation: {
        summary: "Be changes with the subject: I am, he/she/it is, you/we/they are.",
        examples: [
          { text: "I am from Spain." },
          { text: "She is a teacher." },
          { text: "They are happy.", note: "Plural subjects use are." },
        ],
      },
      commonMistakes: [
        { mistake: "They is happy.", correction: "They are happy.", why: "They is plural, so use are." },
        { mistake: "I is tired.", correction: "I am tired.", why: "I always takes am." },
      ],
      intro: "Hey, amigo! Let’s warm up with the verb “be”: am, is and are. Quick and friendly. Ready?",
      homeReason: "A quick, friendly start: the verb “be”. 8 questions · about 5 min.",
      keywords: ["be", "am is are", "to be", "am", "is", "are", "beginner", "basic verbs"],
    },
    beB.finish(),
  ),
  defineSkill(
    {
      id: "a1-articles",
      title: "Articles: a, an, the",
      cefr: "A1",
      mappingRationale: `Basic a/an/the use appears in the earliest noun-phrase work, though full article mastery takes much longer. ${RATIONALE_NOTE}`,
      topic: "Nouns & articles",
      subtopic: "a / an / the",
      objectives: ["Choose a or an by sound", "Use the for something already known", "Spot missing articles"],
      prerequisites: [],
      difficulty: 1,
      estimatedMinutes: 6,
      explanation: {
        summary: "Use a/an for one of many; use the when both people know which one. A vs an depends on the sound.",
        examples: [
          { text: "I have a book and an apple." },
          { text: "The book is on the table.", note: "We both know which book." },
          { text: "She is a university student.", note: "University starts with a consonant sound." },
        ],
      },
      commonMistakes: [
        { mistake: "an university", correction: "a university", why: "Use a before a consonant sound (/j/)." },
        { mistake: "I want to be doctor.", correction: "I want to be a doctor.", why: "Singular job titles need a/an." },
      ],
      intro: "Hey, amigo! Small words, big difference: a, an and the. Let’s sort them out together.",
      homeReason: "Articles are small words that show up everywhere. 8 questions · about 6 min.",
      keywords: ["article", "articles", "a an the", "a", "an", "the", "determiner"],
    },
    artB.finish(),
  ),
  defineSkill(
    {
      id: "a1-present-simple",
      title: "Present simple: routines",
      cefr: "A1",
      mappingRationale: `The present simple for habits and facts is a core early tense. ${RATIONALE_NOTE}`,
      topic: "Verb tenses",
      subtopic: "Present simple (routines)",
      objectives: ["Add -s for he/she/it", "Make questions and negatives with do/does", "Talk about routines"],
      prerequisites: ["a1-be-present"],
      difficulty: 2,
      estimatedMinutes: 6,
      explanation: {
        summary: "Use the present simple for habits and facts. He/she/it takes -s; questions and negatives use do/does.",
        examples: [
          { text: "I work in a shop." },
          { text: "She works in a bank.", note: "he/she/it + -s" },
          { text: "Does he live here?", note: "does + base verb" },
        ],
      },
      commonMistakes: [
        { mistake: "She don’t like tea.", correction: "She doesn’t like tea.", why: "he/she/it uses doesn’t." },
        { mistake: "He play football.", correction: "He plays football.", why: "Add -s for he/she/it." },
      ],
      intro: "Hey, amigo! Let’s talk about habits and routines with the present simple.",
      homeReason: "The present simple is the backbone of everyday English. 8 questions · about 6 min.",
      keywords: ["present simple", "present tense", "routine", "habits", "does", "do", "third person", "verb s", "tenses", "tense"],
    },
    psB.finish(),
  ),
];
