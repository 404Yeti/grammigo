import { forItem, type Case } from "./helpers";

/**
 * UNSEEN corpus 4, written AFTER evaluator 1.1.0 was frozen (hash in FROZEN.json). No sentence here was run through the
 * evaluator, or compared with a rule file, before the single recorded run (docs/guided-correction/holdout4-first-pass.json).
 * Rules are NOT tuned on it. Labels are what a careful teacher would conclude and are PROVISIONAL until an educator reviews them.
 * Single-error sentences only: the two-error ordering question is still open with the educator.
 * It deliberately includes many valid sentences with "for" / "since" / other subordinate clauses, the neighbourhood of the 1.1.0 rules.
 */
const M = forItem("main");
const T1 = forItem("transferFinished");
const T2 = forItem("transferUnfinished");
const X = forItem("experience");

export const HOLDOUT4: Case[] = [
  // ── main (What did you do yesterday evening?) · valid
  M.ok("I made pancakes for my little sister."),
  M.ok("We played board games until it got dark."),
  M.ok("I took a long bath and then I called my mum."),
  M.ok("Yesterday evening I worked on my garden because the weather was so nice."),
  M.ok("I stayed in since I had a headache.", "since_clause_valid"),
  M.ok("I've had a busy week, so yesterday evening I just rested.", "contraction", "mixed_ok"),
  M.ok("I went for a run along the river."),
  M.ok("After dinner I helped my neighbour carry some boxes."),
  M.ok("I sat with my grandfather, who told me stories about his youth."),
  M.ok("Not a lot. I cleaned a bit and watched the news.", "natural_short_answer"),
  M.ok("I was reading a novel when my friend phoned.", "valid_alternative"),
  M.ok("I learned some new words for my English class."),
  M.okSpoken("so um yesterday evening i went to a a birthday party", "asr_style", "filler"),
  M.okSpoken("i just stayed home and uh watched a series", "asr_style", "filler"),
  M.ok("i baked a cake for my aunts birthday", "unrelated_error"),
  // ── main · target errors
  M.wrong("pp_with_finished_time", "I have baked a cake yesterday evening."),
  M.wrong("pp_with_finished_time", "We have walked to the lake last night."),
  M.wrong("pp_with_finished_time", "I've watched a documentary an hour ago.", "contraction"),
  M.wrong("pp_with_finished_time", "Yesterday evening my brother has visited us."),
  M.wrong("pp_with_finished_time", "I have finished my report yesterday and then I relaxed.", "coordination"),
  M.wrongSpoken("pp_with_finished_time", "we have eaten pizza yesterday evening", "asr_style"),
  M.wrong("participle_form", "I have swum in the sea twice this month."),
  M.wrong("participle_form", "She has wore that coat for years."),
  M.wrong("participle_form", "I have forgot my keys again."),
  // ── main · uncertain
  M.maybe("Excuse me?", "not_an_answer"),
  M.maybe("I always go for a walk after dinner.", "habit"),
  M.maybe("Tomorrow evening I will see my cousins.", "wrong_time_frame"),
  M.maybe("I have been very busy lately.", "ambiguous"),

  // ── transfer · finished (Where did you go on your last holiday?)
  T1.ok("I went to Scotland with two friends."),
  T1.ok("We visited a castle and walked in the hills."),
  T1.ok("Since I love beaches, I chose Greece."),
  T1.ok("I didn't travel. I stayed at home and painted my flat.", "contraction", "natural_short_answer"),
  T1.ok("My last holiday was in Norway.", "valid_alternative"),
  T1.ok("We went camping for a week.", "for_duration_valid"),
  T1.okSpoken("um last year we we went to the mountains in austria", "asr_style", "filler"),
  T1.ok("I've been to Peru before, but last summer I went to Chile.", "contraction", "mixed_ok"),
  T1.wrong("pp_with_finished_time", "I have been to Morocco last year."),
  T1.wrong("pp_with_finished_time", "We have flown to Lisbon two weeks ago."),
  T1.wrong("pp_with_finished_time", "Last summer I have stayed with my cousins in Poland."),
  T1.wrong("pp_with_finished_time", "I've visited my grandparents last Christmas.", "contraction"),
  T1.wrong("participle_form", "We have drove across the country many times."),
  T1.wrong("participle_form", "I have swam in three different seas."),
  T1.maybe("What would you recommend?", "not_an_answer"),
  T1.maybe("I want to go to Brazil next year.", "wrong_time_frame"),

  // ── transfer · unfinished (How long have you been learning English?)
  T2.ok("I have been learning English for about eight years."),
  T2.ok("I've studied English since I was in primary school.", "contraction", "since_clause_valid"),
  T2.ok("Since I was eleven.", "short_answer", "since_clause_valid"),
  T2.ok("For almost a year now.", "short_answer"),
  T2.ok("Since I moved to Canada, I have been learning it every day.", "since_clause_valid"),
  T2.ok("I have learned English since I met my husband, because he speaks it.", "since_clause_valid"),
  T2.ok("It's been four years since I started English classes.", "contraction", "since_clause_valid"),
  T2.ok("I haven't stopped studying English since I was a teenager.", "contraction", "since_clause_valid"),
  T2.ok("I've been working on my English for as long as I've lived here.", "contraction", "for_clause_valid"),
  T2.ok("I started when I was ten and I am still learning.", "valid_alternative"),
  T2.ok("About two years, maybe a bit more.", "natural_short_answer"),
  T2.ok("I have been learning it for a long time, since long before I got my job.", "since_clause_valid"),
  T2.okSpoken("um i've been learning for like three years now", "asr_style", "filler"),
  T2.okSpoken("since i was a kid i guess", "asr_style", "since_clause_valid", "short_answer"),
  T2.ok("i have studied english for six months", "unrelated_error"),
  T2.wrong("since_without_perfect", "I study English since I was a little girl."),
  T2.wrong("since_without_perfect", "I am studying English since last March."),
  T2.wrong("since_without_perfect", "I take English lessons since 2022."),
  T2.wrong("since_without_perfect", "I learned English since I moved to Germany."),
  T2.wrong("since_without_perfect", "We practise English together since we met."),
  T2.wrong("since_for_confusion", "I have been learning English since two years."),
  T2.wrong("since_for_confusion", "I've studied English for 2019.", "contraction"),
  T2.wrong("since_for_confusion", "I have learned English for I started school."),
  T2.wrong("since_for_confusion", "I have been studying English since six months."),
  T2.wrong("participle_form", "I have began my English course last month.", "both_errors_ordering_open"),
  T2.maybe("Good question, I'm not sure.", "not_an_answer", "contraction"),
  T2.maybe("I will keep learning English next year.", "wrong_time_frame"),
  T2.maybe("I learned English at school.", "ambiguous"),

  // ── experience (Have you ever tried a food you didn’t like?)
  X.ok("Yes, I have. I tried black pudding and I couldn't eat it."),
  X.ok("No, I haven't. I like everything.", "contraction"),
  X.ok("Once I tasted a very sour fruit and I didn't like it at all.", "contraction"),
  X.ok("Yes, in Japan I ate natto and it was too sticky for me.", "valid_alternative"),
  X.ok("Never.", "short_answer"),
  X.ok("I have tried kale smoothies, but I haven't enjoyed them.", "contraction"),
  X.ok("Yes, I tried it since my friend told me it was delicious, but I disliked it.", "since_clause_valid"),
  X.okSpoken("yes i i tried um blue cheese once and it was horrible", "asr_style", "filler"),
  X.ok("yes i have tryed oysters", "unrelated_error"),
  X.wrong("pp_with_finished_time", "I have tried tripe last week and I hated it."),
  X.wrong("pp_with_finished_time", "Yes, I have eaten a strange dessert yesterday."),
  X.wrong("pp_with_finished_time", "I've tasted rabbit in 2020.", "contraction"),
  X.wrong("participle_form", "I have tasted something awful and I have never ate it again."),
  X.wrong("participle_form", "Yes, I have chose a dish I disliked."),
  X.maybe("Do you mean today?", "not_an_answer"),
  X.maybe("I will try something new tomorrow.", "wrong_time_frame"),
  X.maybe("I love food.", "not_an_answer"),
];
