import { forItem, type Case } from "./helpers";

/**
 * HELD-OUT corpus 2. Written after the first held-out set had been used to fix real rule holes,
 * and after two further holes had been fixed by reasoning alone. New vocabulary and structures.
 * It is run ONCE; its first-run result is the clean estimate quoted in the Phase 1 report.
 * It also contains cases I expect to be hard (coordinated verbs, a since-clause with no
 * present-perfect verb, unusual short answers): misses on those are reported, not hidden.
 */
const M = forItem("main");
const T1 = forItem("transferFinished");
const T2 = forItem("transferUnfinished");
const X = forItem("experience");

export const HOLDOUT2: Case[] = [
  // ── main · valid
  M.ok("I went round to my neighbour's and we had tea."),
  M.ok("I tidied my room and then I did some reading."),
  M.ok("Yesterday evening we celebrated my brother's birthday."),
  M.ok("I was out with colleagues until about ten.", "valid_alternative"),
  M.ok("I'd planned to go running but it was raining, so I stayed in.", "contraction"),
  M.ok("I helped my son with his maths homework."),
  M.ok("I took the bus into town and met some friends for dinner."),
  M.ok("Nothing much, I just watched a few videos."),
  M.okSpoken("um yesterday evening i i went to the supermarket and then i cooked", "asr_style", "filler"),
  M.okSpoken("i was at the gym for like an hour", "asr_style", "valid_alternative"),
  M.ok("I've just remembered, I called my sister yesterday evening.", "contraction", "mixed_ok"),
  M.ok("I painted the fence and my hands got covered in paint."),
  M.ok("Yesterday evening, after the rain stopped, I walked home."),
  M.ok("I didn't go out. I read a book and fell asleep.", "contraction"),
  M.ok("I drove my parents to the airport."),
  M.ok("Yesterday evening was quiet.", "valid_alternative"),
  M.ok("I really enjoyed the concert."),
  M.ok("we watched the football match at my uncles house", "unrelated_error"),
  M.ok("I tried a new recipe for lasagne, it was delicious."),
  M.ok("I stayed late at the office to finish a presentation."),
  // ── main · target errors
  M.wrong("pp_with_finished_time", "I have called my grandmother yesterday evening."),
  M.wrong("pp_with_finished_time", "Yesterday evening my friends and I have played cards."),
  M.wrong("pp_with_finished_time", "I have fixed my bike last night."),
  M.wrong("pp_with_finished_time", "I've seen the new Batman film yesterday evening.", "contraction"),
  M.wrong("pp_with_finished_time", "We have decided to go out yesterday."),
  M.wrong("pp_with_finished_time", "Two hours ago I have eaten dinner.", "fronted_marker"),
  M.wrong("pp_with_finished_time", "I have spent the evening with my cousins yesterday."),
  M.wrong("pp_with_finished_time", "I have breaked my phone last night.", "both_errors"),
  M.wrongSpoken("pp_with_finished_time", "i have been to a concert yesterday evening", "asr_style"),
  M.wrong("pp_with_finished_time", "I've cleaned the house and I have cooked dinner last night.", "contraction", "coordination"),
  M.wrong("pp_with_finished_time", "I have gone to the cinema and watched a film yesterday.", "coordination", "hard"),
  M.wrong("participle_form", "I have broke my glasses."),
  M.wrong("participle_form", "I have began my homework late."),
  M.wrong("participle_form", "I haven't chose a film yet.", "contraction"),
  // ── main · uncertain
  M.maybe("Every Friday we cook together.", "habit"),
  M.maybe("I will go to bed early tonight.", "wrong_time_frame"),
  M.maybe("Great, thanks!", "not_an_answer"),
  M.maybe("Why do you ask?", "not_an_answer"),
  M.maybe("I've watched three episodes of the series.", "ambiguous", "contraction"),

  // ── transfer · finished
  T1.ok("We went to a lovely little town in the south of France."),
  T1.ok("I visited my sister in Canada last August."),
  T1.ok("I didn't take a holiday, I worked all summer.", "contraction"),
  T1.ok("We hiked in the Dolomites for ten days."),
  T1.okSpoken("so we like drove down to the coast and stayed in a tent", "asr_style", "filler"),
  T1.ok("I have never left Europe, but I went to Morocco in 2022.", "mixed_ok"),
  T1.ok("I've been lucky: last year I went to Thailand.", "contraction", "mixed_ok"),
  T1.ok("We rented bikes and cycled along the river."),
  T1.wrong("pp_with_finished_time", "Last year I have been to Thailand.", "fronted_marker"),
  T1.wrong("pp_with_finished_time", "We have gone to Scotland two summers ago."),
  T1.wrong("pp_with_finished_time", "I've stayed in a hostel in Berlin last month.", "contraction"),
  T1.wrong("participle_form", "I have took lots of photos in Rome."),
  T1.wrongSpoken("pp_with_finished_time", "i have went to the mountains in 2021", "asr_style", "both_errors"),
  T1.wrong("pp_with_finished_time", "We have spent a week in Lisbon last July."),
  T1.maybe("I've visited many countries.", "ambiguous", "contraction"),
  T1.maybe("Maybe Italy.", "fragment", "no_verb"),

  // ── transfer · unfinished
  T2.ok("I have worked here since 2015."),
  T2.ok("She has been ill since Monday."),
  T2.ok("It has rained since this morning."),
  T2.ok("I haven't seen him for ages.", "contraction"),
  T2.ok("I don't know exactly, maybe since 2020.", "contraction", "hedge", "natural_short_answer"),
  T2.ok("I've been learning English for what feels like forever.", "contraction"),
  T2.ok("I started in 2018, so about seven years.", "valid_alternative"),
  T2.ok("I was learning English two years ago.", "valid_alternative"),
  T2.ok("Hmm, I'm not sure, since 2019 I think.", "hedge", "natural_short_answer", "contraction"),
  T2.ok("I've been practising English since I came to this country.", "contraction", "since_clause"),
  T2.ok("Since I came here.", "natural_short_answer", "since_clause", "hard"),
  T2.ok("I think about two years, but I'm not certain.", "natural_short_answer", "hedge", "hard"),
  T2.wrong("since_for_confusion", "I work here since three years."),
  T2.wrong("since_for_confusion", "I have lived in London since five years."),
  T2.wrong("since_without_perfect", "I am a teacher since 2010."),
  T2.wrong("since_for_confusion", "I have studied English for last winter."),
  T2.wrong("since_without_perfect", "I played the piano since I was seven.", "since_clause", "hard"),
  T2.wrong("since_for_confusion", "I have known him since 2 years."),
  T2.wrong("pp_with_finished_time", "We have lived here yesterday."),
  T2.maybe("Not sure.", "no_verb"),

  // ── experience
  X.ok("I have, actually. Mushrooms!", "short_answer", "hard"),
  X.ok("Yes, I once tried fried grasshoppers in Mexico.", "valid_alternative"),
  X.ok("I haven't, no.", "short_answer", "contraction"),
  X.ok("Many times! I've tried plenty of foods I couldn't stand.", "contraction"),
  X.ok("No, I eat everything.", "valid_alternative"),
  X.ok("I've never tried a food I didn't like.", "contraction"),
  X.ok("Once, at a wedding, I ate something strange.", "valid_alternative"),
  X.ok("Probably, but I can't remember what it was.", "contraction", "valid_alternative"),
  X.wrong("pp_with_finished_time", "Yes, I have tried frog legs last month."),
  X.wrong("participle_form", "I have ate some strange sweets."),
  X.wrong("pp_with_finished_time", "I've eaten snails for dinner yesterday.", "contraction"),
  X.wrong("pp_with_finished_time", "Yes, I have tasted worse food two years ago."),
  X.wrong("participle_form", "Yes, I have drunk a strange tea and I have spoke to the owner about it."),
  X.maybe("I'm not a picky eater.", "contraction"),
  X.maybe("Hmm.", "filler_only"),
  X.maybe("Depends on the day.", "no_verb"),
];
