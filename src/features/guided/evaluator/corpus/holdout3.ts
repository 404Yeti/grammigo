import { forItem, type Case } from "./helpers";

/**
 * UNSEEN corpus 3 (evaluator v1.0.0, FROZEN). Written after the rules were frozen, without running
 * any of these sentences through the evaluator and without looking at the rule files while writing.
 * Labels are what a careful teacher would conclude. It is run ONCE; the first-pass result is recorded
 * in docs/guided-correction/holdout3-first-pass.json and reported as-is. Rules are NOT tuned on it.
 * If the evaluator is ever changed, this set is "seen" and a new unseen set must be written.
 * Labels are provisional until an educator has reviewed them.
 */
const M = forItem("main");
const T1 = forItem("transferFinished");
const T2 = forItem("transferUnfinished");
const X = forItem("experience");

export const HOLDOUT3: Case[] = [
  // ── main (What did you do yesterday evening?) · valid
  M.ok("I cleaned the kitchen and listened to a podcast."),
  M.ok("We ordered pizza and watched a documentary about space."),
  M.ok("I visited my aunt, she lives near the river."),
  M.ok("Yesterday evening I had a long phone call with my best friend."),
  M.ok("I was studying for my exam until midnight.", "valid_alternative"),
  M.ok("I didn't do much. I just lay on the sofa.", "contraction", "natural_short_answer"),
  M.ok("I've been tired all week, so I went to bed at eight.", "contraction", "mixed_ok"),
  M.ok("After work I met my brother and we played tennis."),
  M.ok("Not much, I stayed home.", "natural_short_answer"),
  M.ok("I cooked a big dinner for my parents, who had arrived that afternoon."),
  M.ok("I took my dog for a long walk in the park."),
  M.ok("Yesterday evening I finally finished the book I started in March."),
  M.ok("We went bowling, which was great fun."),
  M.ok("I wrote some emails and then I relaxed."),
  M.okSpoken("uh yesterday evening i i made some soup and i watched tv", "asr_style", "filler"),
  M.okSpoken("i went to my friends place for dinner", "asr_style"),
  M.ok("i helped my mum with the shopping", "unrelated_error"),
  M.ok("I sat on the balcony and read the newspaper."),
  // ── main · target errors
  M.wrong("pp_with_finished_time", "I have washed the car yesterday evening."),
  M.wrong("pp_with_finished_time", "Yesterday evening I have watched two episodes of my favourite series."),
  M.wrong("pp_with_finished_time", "We have eaten at a Thai restaurant last night."),
  M.wrong("pp_with_finished_time", "I've written three letters yesterday.", "contraction"),
  M.wrong("pp_with_finished_time", "I have talked to my teacher an hour ago."),
  M.wrong("pp_with_finished_time", "Last night I have slept very badly."),
  M.wrong("pp_with_finished_time", "I have repaired my laptop yesterday evening and then I went to bed.", "coordination"),
  M.wrongSpoken("pp_with_finished_time", "i have seen my cousin yesterday evening", "asr_style"),
  M.wrong("participle_form", "I have swam in the pool this week."),
  M.wrong("participle_form", "I have drank too much coffee today."),
  M.wrong("participle_form", "She has spoke to me about it already."),
  // ── main · uncertain
  M.maybe("Sorry, can you repeat the question?", "not_an_answer"),
  M.maybe("I usually watch TV in the evening.", "habit"),
  M.maybe("I am going to visit my grandparents tomorrow.", "wrong_time_frame"),
  M.maybe("I have just come home.", "ambiguous"),

  // ── transfer · finished (Where did you go on your last holiday?)
  T1.ok("I went to Portugal with my family."),
  T1.ok("We spent a week in the mountains and we hiked every day."),
  T1.ok("I travelled around Japan last summer."),
  T1.ok("Last year we stayed at a small hotel by the sea."),
  T1.ok("I didn't go anywhere. I stayed at home.", "contraction", "natural_short_answer"),
  T1.ok("Italy, it was wonderful.", "short_answer"),
  T1.ok("I visited some old friends in Canada, whom I hadn't seen for years."),
  T1.ok("We drove to the coast and camped for three nights."),
  T1.okSpoken("um we went to to greece last august it was really hot", "asr_style", "filler"),
  T1.ok("My last holiday was in Turkey.", "valid_alternative"),
  T1.ok("I've been to Spain many times but my last holiday was in Wales.", "contraction", "mixed_ok"),
  T1.wrong("pp_with_finished_time", "I have gone to Croatia last summer."),
  T1.wrong("pp_with_finished_time", "We have visited Rome two years ago."),
  T1.wrong("pp_with_finished_time", "Last August I have travelled to Iceland."),
  T1.wrong("pp_with_finished_time", "I've been to the beach last weekend.", "contraction"),
  T1.wrong("participle_form", "I have flew to Dubai twice."),
  T1.wrong("participle_form", "We have wrote postcards to everyone."),
  T1.maybe("Where do you think I should go?", "not_an_answer"),
  T1.maybe("I want to go to Australia one day.", "wrong_time_frame"),
  T1.maybe("I go to the seaside every year.", "habit"),

  // ── transfer · unfinished (How long have you been learning English?)
  T2.ok("I have been learning English for six years."),
  T2.ok("I've been learning it since 2019.", "contraction"),
  T2.ok("For about three years.", "short_answer"),
  T2.ok("Since I was a teenager.", "short_answer"),
  T2.ok("I have studied English since I started secondary school."),
  T2.ok("I've learned English for ten months now.", "contraction"),
  T2.ok("We have been doing lessons together for two years, my teacher and I."),
  T2.ok("Not very long, only a few weeks.", "natural_short_answer"),
  T2.okSpoken("i have been learning english for like four years now", "asr_style"),
  T2.okSpoken("um since last september", "asr_style", "filler", "short_answer"),
  T2.ok("I started learning English in 2020 and I still study it every day.", "valid_alternative"),
  T2.ok("I have been studying english since last year", "unrelated_error"),
  T2.wrong("since_without_perfect", "I learn English since four years."),
  T2.wrong("since_without_perfect", "I am learning English since 2021."),
  T2.wrong("since_without_perfect", "I study English since I was twelve."),
  T2.wrong("since_for_confusion", "I have been learning English since three years."),
  T2.wrong("since_for_confusion", "I've studied English for 2018.", "contraction"),
  T2.wrong("since_for_confusion", "I have learned English for I was a child."),
  T2.wrong("participle_form", "I have began to learn English two years ago.", "both_errors"),
  T2.maybe("What a good question!", "not_an_answer"),
  T2.maybe("I will learn English next year.", "wrong_time_frame"),
  T2.maybe("I learned English at school.", "ambiguous"),

  // ── experience (Have you ever tried a food you didn’t like?)
  X.ok("Yes, I tried octopus once and I didn't enjoy it.", "contraction"),
  X.ok("Yes, I have. I tried durian in Malaysia and it smelled awful."),
  X.ok("No, never.", "short_answer"),
  X.ok("I've never tried anything I really hated.", "contraction"),
  X.ok("Yes, last year I ate a very spicy curry and I couldn't finish it.", "contraction"),
  X.ok("Once, in a restaurant in Seoul, I tasted something that I didn't like at all.", "contraction"),
  X.ok("I have tried sushi, but I didn't like it.", "contraction"),
  X.ok("Yes, I have tried liver. I hate it.", "valid_alternative"),
  X.ok("Mushrooms. I tried them as a child and I never liked them.", "valid_alternative"),
  X.okSpoken("yes um i tried blue cheese last year and i i didnt like it", "asr_style", "filler"),
  X.okSpoken("no i have never tried a food i didnt like", "asr_style"),
  X.ok("Yes, I have tryed snails once.", "unrelated_error"),
  X.wrong("pp_with_finished_time", "I have tried a strange soup last week and I didn't like it.", "contraction"),
  X.wrong("pp_with_finished_time", "Yes, I have eaten raw fish yesterday and it was horrible."),
  X.wrong("pp_with_finished_time", "I have tasted goat cheese in 2019."),
  X.wrong("participle_form", "I have ate something terrible once."),
  X.wrong("participle_form", "Yes, I have tasted worms. I have never forgot it."),
  X.maybe("I like all food.", "not_an_answer"),
  X.maybe("What about you?", "not_an_answer"),
  X.maybe("I will try new food tomorrow.", "wrong_time_frame"),
];
