import type { Lesson, Question } from "@/types/lesson";

/** Authored meaning checks: every choice is grammatical, so listening is necessary. */
const SCENARIOS: Record<string, [string, string, string[], string]> = {
  "a1-be-present": ["Lisa works at a primary school. Every morning, she teaches children to read and write.", "What is Lisa’s job?", ["She is a doctor.", "She is a student.", "She is a driver."], "Listen for Lisa’s job. Use is with she."],
  "a1-articles": ["It is raining. My friend opens her umbrella and holds it above her head to stay dry.", "What does my friend have?", ["She has a raincoat.", "She has a book.", "She has a hat."], "Listen for the object. Use an before the vowel sound in umbrella."],
  "a1-present-simple": ["Tom loves football. Every Sunday, he meets his friends at the park and they play together.", "Which sentence describes Tom’s routine?", ["He plays football on Mondays.", "He goes swimming on Sundays.", "He plays basketball on Sundays."], "Listen for the activity and day. Use plays with he for a routine."],
  "a2-past-simple": ["Yesterday, I went to school. The day before that, I stayed at home because I was ill.", "What did the speaker do yesterday?", ["I stayed at home yesterday.", "I visited a friend yesterday.", "I went to work yesterday."], "Listen for yesterday. Went is the past simple of go."],
  "a2-prepositions-time": ["Our English class is on Friday. It starts at nine o’clock. The library opens an hour later, at ten.", "When does the class start?", ["The class starts at 8 o’clock.", "The class starts at 10 o’clock.", "The class starts at 11 o’clock."], "Listen for the class time. Use at with a clock time."],
  "a2-comparatives": ["This book in my hand costs five euros. That book on the shelf costs ten euros.", "How do the book prices compare?", ["This book is more expensive than that one.", "This book costs the same as that one.", "This book is free."], "Listen for both prices. Cheaper than compares a lower price with a higher one."],
  "a2-quantifiers": ["I want to buy a sandwich, but my wallet is empty. There are no coins or notes inside it.", "Which sentence describes the speaker’s situation?", ["I have some money.", "I have more money than I need.", "I have two coins."], "Listen for the empty wallet. Use any in the negative sentence about money."],
  "present-perfect-vs-past-simple": ["I love travelling. Hanoi is one of my favourite cities, and I have been there twice. I hope to return someday.", "Which sentence matches the speaker’s experience of Hanoi?", ["I visited Hanoi last year.", "I was visiting Hanoi when it rained.", "I will visit Hanoi for the first time tomorrow."], "Listen for the number of visits. Use the present perfect for experience without a finished time."],
  "b1-first-conditional": ["I have some news for Sam. I have not seen him today, but if I see him later, I will tell him.", "What is the speaker’s plan if they meet Sam?", ["If I see him, I will keep the news secret.", "If I see him, I will ask for directions.", "If I see him, I will leave without speaking."], "Listen for the possible plan. Use if plus present simple, then will plus the base verb."],
  "b1-passive-voice": ["My mother baked a cake yesterday. She finished it before our party began.", "Which sentence tells us who made the cake?", ["The cake was baked by my brother.", "The cake will be baked tomorrow.", "The cake was bought at a shop."], "Listen for who made the cake. The past passive uses was plus the past participle."],
  "b1-past-perfect": ["I arrived at the cinema at seven. The film had started at ten past six, so I missed the beginning.", "Which sentence describes the order of events?", ["When I arrived, the film had not started.", "The film started after I arrived.", "I left before the film started."], "Listen for which event came first. Use the past perfect for the earlier past event."],
  "b2-second-third-conditionals": ["I have not won the lottery. I am just imagining it. If I won, I would travel around the world.", "What would the speaker do in this imaginary situation?", ["If I won the lottery, I would buy a house.", "If I won the lottery, I would give all the money away.", "If I won the lottery, I would stay at home."], "Listen for the imagined plan. Use if plus past simple, then would plus the base verb."],
  "b2-reported-speech": ["Earlier today, Emma told me, I am tired. Now I am telling you how she felt.", "How can we report what Emma said?", ["She said she was hungry.", "She said she was happy.", "She said she was ready."], "Listen for Emma’s feeling. In reported speech, am becomes was after said."],
};

export function listeningQuestion(lesson: Lesson): Question | undefined {
  const scenario = SCENARIOS[lesson.id];
  const original = lesson.questions[0];
  if (!scenario || !original.options) return;
  const [transcript, prompt, distractors, rule] = scenario;
  let next = 0;
  return {
    ...original, id: "q9-listening", reviewTitle: "Listening comprehension",
    prompt: `Listen to Migo. ${prompt}`, skillLabel: `${lesson.grammarFocus} · Listening`,
    listening: { transcript },
    options: original.options.map(option => ({ ...option, label: original.acceptedAnswers.includes(option.id) ? option.label : distractors[next++] })),
    hints: [rule], explanation: `${rule} ${original.displayAnswer}`,
    migoLine: "Listen for the meaning. Replay the audio or choose the reading alternative.",
    nudge: { title: "Let’s listen once more.", body: rule },
    misconceptions: undefined,
  };
}
