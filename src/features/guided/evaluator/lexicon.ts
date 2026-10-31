/**
 * Word lists for the Guided Correction evaluator (Past simple vs Present perfect pilot).
 *
 * Everything here is deliberately conservative: a word that could be read two ways is left OUT of
 * the lists that produce evidence, so ambiguity ends in "uncertain", never in a false verdict.
 */

interface Irregular {
  base: string;
  past: string[];
  participle: string[];
}

const irr = (base: string, past: string, participle: string): Irregular => ({
  base,
  past: past.split("/"),
  participle: participle.split("/"),
});

export const IRREGULAR: readonly Irregular[] = [
  irr("be", "was/were", "been"), irr("become", "became", "become"), irr("begin", "began", "begun"),
  irr("bend", "bent", "bent"), irr("bite", "bit", "bitten"), irr("blow", "blew", "blown"),
  irr("break", "broke", "broken"), irr("bring", "brought", "brought"), irr("build", "built", "built"),
  irr("buy", "bought", "bought"), irr("catch", "caught", "caught"), irr("choose", "chose", "chosen"),
  irr("come", "came", "come"), irr("deal", "dealt", "dealt"), irr("dig", "dug", "dug"),
  irr("do", "did", "done"), irr("draw", "drew", "drawn"), irr("drink", "drank", "drunk"),
  irr("drive", "drove", "driven"), irr("eat", "ate", "eaten"), irr("fall", "fell", "fallen"),
  irr("feed", "fed", "fed"), irr("feel", "felt", "felt"), irr("fight", "fought", "fought"),
  irr("find", "found", "found"), irr("flee", "fled", "fled"), irr("fly", "flew", "flown"),
  irr("forget", "forgot", "forgotten"), irr("forgive", "forgave", "forgiven"), irr("freeze", "froze", "frozen"),
  irr("get", "got", "got/gotten"), irr("give", "gave", "given"), irr("go", "went", "gone"),
  irr("grow", "grew", "grown"), irr("hang", "hung", "hung"), irr("have", "had", "had"),
  irr("hear", "heard", "heard"), irr("hide", "hid", "hidden"), irr("hold", "held", "held"),
  irr("keep", "kept", "kept"), irr("know", "knew", "known"), irr("lay", "laid", "laid"),
  irr("lead", "led", "led"), irr("leave", "left", "left"), irr("lend", "lent", "lent"),
  irr("light", "lit", "lit"), irr("lose", "lost", "lost"), irr("make", "made", "made"),
  irr("mean", "meant", "meant"), irr("meet", "met", "met"), irr("pay", "paid", "paid"),
  irr("ride", "rode", "ridden"), irr("ring", "rang", "rung"), irr("rise", "rose", "risen"),
  irr("run", "ran", "run"), irr("say", "said", "said"), irr("see", "saw", "seen"),
  irr("sell", "sold", "sold"), irr("send", "sent", "sent"), irr("shake", "shook", "shaken"),
  irr("shoot", "shot", "shot"), irr("sing", "sang", "sung"), irr("sink", "sank", "sunk"),
  irr("sit", "sat", "sat"), irr("sleep", "slept", "slept"), irr("slide", "slid", "slid"),
  irr("speak", "spoke", "spoken"), irr("spend", "spent", "spent"), irr("spin", "spun", "spun"),
  irr("stand", "stood", "stood"), irr("steal", "stole", "stolen"), irr("stick", "stuck", "stuck"),
  irr("strike", "struck", "struck"), irr("swear", "swore", "sworn"), irr("sweep", "swept", "swept"),
  irr("swim", "swam", "swum"), irr("take", "took", "taken"), irr("teach", "taught", "taught"),
  irr("tear", "tore", "torn"), irr("tell", "told", "told"), irr("think", "thought", "thought"),
  irr("throw", "threw", "thrown"), irr("understand", "understood", "understood"), irr("wake", "woke", "woken"),
  irr("wear", "wore", "worn"), irr("weep", "wept", "wept"), irr("win", "won", "won"),
  irr("wind", "wound", "wound"), irr("write", "wrote", "written"),
];

/** Past forms that are ALSO present/base forms in writing: never used as evidence of past tense. */
const AMBIGUOUS_PAST = new Set(["read", "put", "set", "let", "cut", "hit", "hurt", "shut", "cost", "spread", "quit", "bet", "burst", "cast", "split", "beat"]);

/** Participles that may be written the same as the base form: evidence for "have + participle" only. */
const EXTRA_PARTICIPLES = ["read", "put", "set", "let", "cut", "hit", "hurt", "shut", "cost", "spread", "quit", "beat", "beaten", "shown", "proven", "learnt", "burnt", "dreamt", "spelt", "spoilt"];

export const PAST_FORMS: ReadonlySet<string> = new Set(
  IRREGULAR.flatMap((e) => e.past).filter((w) => !AMBIGUOUS_PAST.has(w)),
);

export const PARTICIPLES: ReadonlySet<string> = new Set([...IRREGULAR.flatMap((e) => e.participle), ...EXTRA_PARTICIPLES]);

/** A simple-past form that is NOT the participle ("went"), mapped to the participle ("gone"). */
export const WRONG_PARTICIPLE: ReadonlyMap<string, string> = new Map(
  IRREGULAR.filter((e) => e.base !== "be" && !e.participle.some((p) => e.past.includes(p))).flatMap((e) =>
    e.past.map((p) => [p, e.participle[0]] as const),
  ),
);

/** Participles safe to read after "'s" as "has" ("he's gone"). Regular -ed after "'s" stays ambiguous. */
export const STRONG_PARTICIPLES: ReadonlySet<string> = new Set([
  "been", "gone", "done", "seen", "eaten", "written", "taken", "made", "begun", "broken", "chosen", "drunk", "driven",
  "given", "known", "spoken", "stolen", "forgotten", "grown", "worn", "flown", "had", "got", "gotten", "met", "found",
]);

/** Common base verbs, used only to decide whether a text has a verb at all (never as tense evidence). */
export const BASE_VERBS: ReadonlySet<string> = new Set([
  ...IRREGULAR.map((e) => e.base),
  "watch", "play", "visit", "work", "study", "learn", "live", "like", "love", "need", "want", "try", "start", "stop",
  "call", "talk", "walk", "cook", "clean", "help", "use", "look", "show", "ask", "answer", "open", "close", "wait",
  "travel", "stay", "enjoy", "relax", "listen", "read", "put", "set", "let", "cut", "hit", "move", "turn", "change",
  "check", "finish", "plan", "prepare", "practice", "practise", "remember", "decide", "hope", "wish", "miss", "love",
  "hate", "prefer", "taste", "order", "book", "arrive", "return", "join", "meet", "text", "message", "email", "post",
  "paint", "draw", "dance", "exercise", "train", "shop", "buy", "pack", "pick", "carry", "drop", "fix", "build",
]);

export const AUXILIARIES: ReadonlySet<string> = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "may", "might", "must", "shall",
]);

/** Words that look like regular "-ed" verbs but are not past forms. */
const NOT_ED_VERB = new Set([
  "need", "feed", "speed", "bleed", "breed", "seed", "weed", "deed", "heed", "reed", "proceed", "succeed", "exceed",
  "indeed", "hundred", "kindred", "sacred", "naked", "wicked", "rugged", "beloved", "bed", "red", "shed", "wed",
  "embed", "sled", "sped", "led", "fed",
]);

/** Participial adjectives: never evidence of a past-tense verb on their own. */
export const ADJECTIVAL_ED: ReadonlySet<string> = new Set([
  "tired", "bored", "excited", "interested", "worried", "surprised", "relaxed", "scared", "married", "pleased",
  "annoyed", "confused", "embarrassed", "disappointed", "shocked", "satisfied", "crowded", "limited", "advanced",
  "talented", "experienced", "educated", "supposed", "determined", "exhausted", "amazed", "thrilled", "delighted",
  "stressed", "frightened", "puzzled", "concerned", "involved", "interested", "organised", "organized", "tired",
]);

export const isRegularEd = (w: string): boolean => /^[a-z]{2,}ed$/.test(w) && !NOT_ED_VERB.has(w);

/** "-ing" words that are not verbs. */
const NOT_ING = new Set(["thing", "something", "anything", "nothing", "everything", "morning", "evening", "king", "ring", "spring", "string", "wing", "sing", "bring", "swing", "during", "building", "wedding", "meeting", "feeling", "ceiling", "clothing"]);
export const looksIng = (w: string): boolean => /^[a-z]{3,}ing$/.test(w) && !NOT_ING.has(w) && w.length > 4;

export const MODAL_OR_TO: ReadonlySet<string> = new Set(["to", "will", "would", "could", "should", "might", "must", "may", "can", "shall", "'d", "ll"]);

/** Adverbs allowed between "have/has" and the participle ("I have just finished"). */
export const PERFECT_ADVERBS: ReadonlySet<string> = new Set([
  "already", "just", "never", "ever", "not", "also", "still", "only", "really", "finally", "always", "often", "once",
  "twice", "recently", "lately", "yet", "even", "probably", "definitely", "actually", "both", "all", "now", "again", "so",
]);

export const PRESENT_BE: ReadonlySet<string> = new Set(["am", "is", "are", "'s", "be", "being"]);

export const NUMBER_WORDS = "(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|several|few|a few|a couple of|couple of|many|half an|half a)";
export const UNITS = "(?:second|minute|hour|day|week|month|year|decade)s?";
export const WEEKDAYS = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
export const MONTHS = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";

/** Learners' stock verbs used to build rung-3 examples that never reuse the learner's own verb. */
export const EXAMPLE_VERBS: readonly { base: string; past: string; participle: string }[] = [
  { base: "see", past: "saw", participle: "seen" },
  { base: "eat", past: "ate", participle: "eaten" },
  { base: "write", past: "wrote", participle: "written" },
  { base: "take", past: "took", participle: "taken" },
  { base: "go", past: "went", participle: "gone" },
];
