import { forItem, type Case } from "./helpers";

/**
 * HELD-OUT corpus. Written AFTER the rules were stable on the dev corpus and NOT used for tuning:
 * the first-run result is recorded in the Phase 1 report. It deliberately includes realistic valid
 * sentences that could trip the rules (a time expression that belongs to a since-clause or a
 * relative clause, hedged or unusual short answers) and corrections that are still wrong.
 *
 * If a rule is changed because of a failure here, the sentence is copied into the dev corpus as a
 * regression test and the report says so: the held-out number is then no longer a clean estimate.
 */
const M = forItem("main");
const T1 = forItem("transferFinished");
const T2 = forItem("transferUnfinished");
const X = forItem("experience");

export const HOLDOUT: Case[] = [
  // ── main · valid
  M.ok("Honestly I just crashed on the sofa and binge-watched a series."),
  M.ok("I've had a long day so I ordered takeaway and went to bed early.", "contraction", "mixed_same_clause_valid"),
  M.ok("We were supposed to go out but it rained so we stayed in."),
  M.ok("I picked my daughter up from school, and then we baked cookies."),
  M.ok("Yesterday evening my friends came over and we played board games until midnight."),
  M.ok("I FaceTimed my parents for about an hour."),
  M.ok("I finished my report and I sent it to my boss."),
  M.ok("After dinner I scrolled through my phone for ages."),
  M.ok("Not a lot, I just chilled."),
  M.ok("I was on a call with my manager most of the evening.", "valid_alternative"),
  M.ok("I had a quick workout, then I made some soup."),
  M.ok("I rewatched my favourite film."),
  M.ok("I kind of slept all evening, to be honest."),
  M.ok("I ran five kilometres by the river."),
  M.ok("I attended a yoga class downtown."),
  M.okSpoken("so yesterday evening i basically cooked for my roommates and we ate together", "asr_style"),
  M.okSpoken("uh i went to my friends house we like watched a movie", "asr_style", "filler"),
  M.okSpoken("I've been... no wait, I went to the market and bought vegetables.", "self_repair", "contraction"),
  M.ok("I've no idea, I think I just slept.", "contraction"),
  M.ok("Yesterday evening I couldn't sleep, so I read and then I listened to music.", "contraction"),
  M.ok("I cooked dinner and washed up."),
  M.ok("I have gone shopping, and yesterday I bought shoes.", "mixed_ok"),
  M.ok("yesterday evening i was go to cinema", "unrelated_error"),
  M.ok("I have read the book you gave me yesterday.", "attached_marker", "relative_clause"),
  M.ok("I've finished the book that you lent me last week.", "attached_marker", "relative_clause", "contraction"),
  M.okSpoken("so yeah i have i mean i went to a restaurant with my family last night", "self_repair"),
  // ── main · target errors
  M.wrong("pp_with_finished_time", "I've already finished my homework yesterday evening.", "contraction"),
  M.wrong("pp_with_finished_time", "Yesterday evening I have been at the gym."),
  M.wrong("pp_with_finished_time", "I have had pasta for dinner yesterday."),
  M.wrong("pp_with_finished_time", "I have called my mum last night."),
  M.wrong("pp_with_finished_time", "My brother has visited me yesterday evening and we have cooked."),
  M.wrong("pp_with_finished_time", "I have ran five kilometres yesterday.", "both_errors"),
  M.wrong("pp_with_finished_time", "She has went home early yesterday evening.", "both_errors"),
  M.wrong("pp_with_finished_time", "Last weekend I have bought new shoes."),
  M.wrong("pp_with_finished_time", "We have seen a film two days ago."),
  M.wrongSpoken("pp_with_finished_time", "i have cooked pasta yesterday evening with my sister", "asr_style"),
  M.wrongSpoken("pp_with_finished_time", "I have eated pizza last night", "both_errors"),
  M.wrong("pp_with_finished_time", "I haven't slept well last night.", "contraction"),
  M.wrong("pp_with_finished_time", "I have done nothing special yesterday."),
  M.wrong("pp_with_finished_time", "I was tired. I have gone to bed early last night.", "second_sentence"),
  M.wrong("pp_with_finished_time", "I HAVE WATCHED A FILM YESTERDAY!!!", "upper_case"),
  M.wrongSpoken("pp_with_finished_time", "I went... sorry I have watched a film yesterday", "self_repair_still_wrong"),
  M.wrong("participle_form", "I have woke up late."),
  M.wrong("participle_form", "He has drank all the milk."),
  // ── main · uncertain
  M.maybe("That depends."),
  M.maybe("I don't eat meat."),
  M.maybe("Tell me more."),
  M.maybe("I'd rather not say.", "contraction"),
  M.maybe("It's been a long time since I last went to the cinema.", "ambiguous", "contraction"),
  M.maybe("I haven't eaten anything since yesterday.", "ambiguous", "contraction"),

  // ── transfer · finished
  T1.ok("I spent two weeks in Greece."),
  T1.ok("We took the train to Vienna and stayed with friends."),
  T1.ok("I backpacked around Vietnam in 2019."),
  T1.ok("I never went on holiday last year, I was working."),
  T1.ok("I've never been abroad, but I went camping in Scotland last summer.", "contraction", "mixed_ok"),
  T1.ok("My husband and I went to a small island near Crete."),
  T1.okSpoken("we went to um to the beach in portugal", "asr_style", "filler"),
  T1.ok("I have never been to Japan, but I went to Korea last year.", "mixed_ok"),
  T1.ok("I've been to Italy twice. The last time was in 2019.", "contraction", "mixed_ok"),
  T1.ok("I have visited the island that you recommended last year.", "attached_marker", "relative_clause"),
  T1.ok("It was great.", "valid_alternative"),
  T1.wrong("pp_with_finished_time", "Last summer we have travelled to Croatia.", "fronted_marker"),
  T1.wrong("pp_with_finished_time", "I have visited my grandparents two weeks ago."),
  T1.wrong("pp_with_finished_time", "We've booked a hotel in Rome last month.", "contraction"),
  T1.wrong("participle_form", "I have went to the Alps."),
  T1.wrong("pp_with_finished_time", "I have gone to Mexico in 2018."),
  T1.wrongSpoken("pp_with_finished_time", "we have went to italy last year", "asr_style", "both_errors"),
  T1.maybe("A small village near Naples.", "fragment", "no_verb"),

  // ── transfer · unfinished
  T2.ok("I've been taking English classes for roughly two years.", "contraction"),
  T2.ok("Since I moved here in 2021.", "natural_short_answer", "since_clause"),
  T2.ok("Only a few months.", "natural_short_answer", "fragment"),
  T2.ok("Since my childhood.", "natural_short_answer", "fragment"),
  T2.ok("For nearly a decade.", "natural_short_answer", "fragment"),
  T2.ok("I've been studying English on and off since high school.", "contraction"),
  T2.ok("I have learned English since I was in primary school."),
  T2.ok("My whole life, really.", "natural_short_answer", "fragment"),
  T2.ok("I started learning in 2020 and I haven't stopped since.", "contraction"),
  T2.ok("I've lived here since I arrived two years ago.", "attached_marker", "since_clause", "contraction"),
  T2.ok("She has worked here since she graduated in 2019.", "attached_marker", "since_clause"),
  T2.ok("We have been friends for a long time, since we met in 2015.", "attached_marker", "since_clause"),
  T2.ok("Since last year I have lived in Berlin.", "since_last_year"),
  T2.ok("I've been working here for the last year.", "for_the_last", "contraction"),
  T2.ok("Since I was young.", "natural_short_answer", "since_clause"),
  T2.wrong("since_without_perfect", "I'm studying English since 2020.", "contraction"),
  T2.wrong("since_for_confusion", "I learn English since two years."),
  T2.wrong("since_for_confusion", "I have been learning English since three months."),
  T2.wrong("since_without_perfect", "I am here since September."),
  T2.wrong("since_without_perfect", "I speak English since I was a child.", "since_clause"),
  T2.wrong("since_for_confusion", "I have learned English for 2019."),
  T2.wrong("since_for_confusion", "I've lived in this city for last year.", "contraction"),
  T2.wrong("since_without_perfect", "I work here since yesterday."),
  T2.wrong("since_for_confusion", "I have been waiting since two hours."),
  T2.maybe("I learned English at school.", "no_time_given"),
  T2.maybe("That's a good question.", "contraction"),

  // ── experience
  X.ok("Yes, once I tried a really bitter melon."),
  X.ok("I haven't, I'm quite adventurous with food.", "contraction"),
  X.ok("I've had a few bad experiences, yes.", "contraction"),
  X.ok("Yes, I once ate a century egg in Beijing.", "valid_alternative"),
  X.ok("Yes, I have tried to eat insects, but I couldn't finish them.", "contraction"),
  X.ok("Never in my life.", "short_answer"),
  X.ok("I have eaten worse things."),
  X.ok("Yes! Last year I tried tripe soup, it was awful.", "valid_alternative"),
  X.ok("I have seen it twice since last year.", "since_last_year"),
  X.wrong("pp_with_finished_time", "Yes, I have tried sushi two years ago and I didn't like it.", "contraction"),
  X.wrong("pp_with_finished_time", "I've tasted blood sausage last summer.", "contraction"),
  X.wrong("participle_form", "Yes, I have ate raw fish."),
  X.wrong("pp_with_finished_time", "I have tried liver yesterday."),
  X.wrong("participle_form", "Yes, I have went to a street market and I have took a strange dish.", "both_errors"),
  X.maybe("Possibly.", "no_verb"),
  X.maybe("I don't eat meat.", "ambiguous"),
];
