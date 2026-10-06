// Swimming Game IQ: World Aquatics race rules in words, and questions
// about one race (who won, times, reactions, disqualifications).

import type { Explanation, SportKnowledge } from "../core/ask";
import { hasWord, norm } from "../core/ask";
import { formatDuration } from "../core/util";
import { swimEventName, type SwimmingRules, type SwimmingState } from "../sports/swimming";

export const SWIMMING_KNOWLEDGE: SportKnowledge<SwimmingRules, SwimmingState> = {
  glossary: [
    { term: "Freestyle", aliases: ["front crawl"], meaning: "Any stroke is allowed; almost everyone swims front crawl." },
    { term: "Backstroke", meaning: "Swum on the back; the race starts in the water." },
    { term: "Breaststroke", meaning: "Arms and legs move together in a symmetrical, frog-like kick; both hands must touch the wall together at each turn and the finish." },
    { term: "Butterfly", aliases: ["fly"], meaning: "Both arms recover over the water together, with a dolphin kick; two-hand touch at turns and the finish." },
    { term: "Individual medley", aliases: ["im", "medley"], meaning: "One swimmer swims all four strokes: butterfly, backstroke, breaststroke, freestyle." },
    { term: "Medley relay", meaning: "Four swimmers swim backstroke, breaststroke, butterfly and freestyle, in that order." },
    { term: "Split", aliases: ["splits", "split time"], meaning: "The time at an intermediate distance, usually each 50 m." },
    { term: "Reaction time", aliases: ["reaction"], meaning: "Time from the start signal until the swimmer leaves the block." },
    { term: "False start", meaning: "Leaving the block before the start signal. Under the one-start rule it is an immediate disqualification." },
    { term: "Disqualification", aliases: ["dq", "dsq", "disqualified"], meaning: "A swim that broke a stroke, turn, start or relay-exchange rule. It gets no time or place." },
    { term: "Heat", aliases: ["heats"], meaning: "A preliminary race; the fastest times overall go through to the next round." },
    { term: "Personal best", aliases: ["pb", "personal record"], meaning: "A swimmer's fastest ever time in that event and pool length." },
    { term: "Long course", aliases: ["short course", "lcm", "scm"], meaning: "Long course is a 50 m pool, short course 25 m. Times are only compared within the same pool length." },
    { term: "Touchpad", aliases: ["touch pad"], meaning: "The pad on the wall that stops the clock when the swimmer touches it." },
    { term: "Dead heat", aliases: ["tie"], meaning: "Two swimmers with the same official time (to the hundredth): they share the place." },
  ],
  rules: (r) => [
    { re: /what (race|event)|which (race|event)|how far|distance/, answer: `${swimEventName(r)} in a ${r.course} m pool, ${r.round.replace("_", " ")} ${r.heat}.` },
    { re: /false start/, answer: r.falseStartRule === "one_start" ? "One-start rule: any swimmer who starts before the signal is disqualified." : "Two-start rule: the first false start is a warning to the field; the next swimmer to false start is disqualified." },
    { re: /how (is|are) (the )?(places?|rank|winner) (decided|worked out)|how (is|does) ranking|tie|dead heat/, answer: `Places go by official time to the ${r.rankPrecisionMs >= 10 ? "hundredth" : "thousandth"} of a second; equal times share a place. A disqualified, non-starting or non-finishing swimmer gets no place.` },
    { re: /relay/, answer: r.relay ? `A relay of ${r.relayLegs} swimmers; each must not leave the block before the incoming swimmer touches.` : "This race is not a relay." },
  ],
  stats: [
    { re: /reaction/, key: "reaction", label: "reaction time", format: "time", lowerIsBetter: true },
    { re: /pace|per 100/, key: "pace", label: "pace per 100 m", format: "time", lowerIsBetter: true },
    { re: /behind|gap|margin/, key: "gap", label: "behind the winner", format: "time" },
    { re: /stroke rate/, key: "strokeRate", label: "strokes per minute", format: "dec1" },
    { re: /\bplace\b|position|finish(ed)?/, key: "place", label: "place", lowerIsBetter: true },
    { re: /\btime\b|how fast|fastest|swim/, key: "final", label: "final time", format: "time", lowerIsBetter: true },
  ],
  custom: (q, s, _ctx, r) => {
    const finished = r.entries.filter((e) => s.lanes[e.lane]?.status === "finished" && s.lanes[e.lane].finalMs !== null)
      .sort((x, y) => s.lanes[x.lane].finalMs! - s.lanes[y.lane].finalMs!);
    if (/who (won|is winning|is leading|was first)|winner/.test(q)) {
      return finished[0] ? `${finished[0].name} (lane ${finished[0].lane}) won in ${formatDuration(s.lanes[finished[0].lane].finalMs)}.` : "No one has finished yet.";
    }
    if (/disqualif|\bdq\b|\bdsq\b/.test(q)) {
      const dq = r.entries.filter((e) => s.lanes[e.lane]?.status === "dq");
      const named = dq.find((e) => hasWord(q, norm(e.name)));
      if (named) return `${named.name} was disqualified: ${s.lanes[named.lane].dqReason ?? "no reason recorded"}.`;
      return dq.length ? dq.map((e) => `${e.name} (lane ${e.lane}): ${s.lanes[e.lane].dqReason ?? "no reason recorded"}`).join("; ") + "." : "No one has been disqualified.";
    }
    return null;
  },
  explain: (s) => s.log.slice(-10).map((l): Explanation => ({ kind: "other", text: l.text })),
  guide: (r) => [
    { title: "Race", lines: [`${swimEventName(r)}, ${r.course} m pool, ${r.lanes} lanes.`] },
    { title: "Result", lines: ["Places go by official time; equal times share a place.", "A disqualified swimmer, or one who did not start or finish, gets no place."] },
    { title: "Starts", lines: [r.falseStartRule === "one_start" ? "One-start rule: a false start is a disqualification." : "Two-start rule: one warning to the field, then a false start is a disqualification."] },
    { title: "What the scorer records", lines: ["The start, each swimmer's reaction, splits and finish time.", "Disqualifications with the reason, and swimmers who did not start or finish."] },
  ],
  insights: (s, _ctx, r) => swimmingInsights(s, r),
  suggestions: ["Who won?", "What was the fastest reaction?", "Who was disqualified?", "What is a split?", "How are places decided?"],
};

/** "What the data says" for one race, from the recorded times. */
export function swimmingInsights(s: SwimmingState, r: SwimmingRules): string[] {
  const out: string[] = [];
  const lane = (n: number) => s.lanes[n];
  const official = (ms: number) => Math.floor(ms / r.rankPrecisionMs) * r.rankPrecisionMs;
  const finished = r.entries.filter((e) => lane(e.lane)?.status === "finished" && lane(e.lane).finalMs !== null)
    .sort((x, y) => lane(x.lane).finalMs! - lane(y.lane).finalMs!);
  if (finished[0]) {
    const w = finished[0], wt = lane(w.lane).finalMs!;
    const tied = finished.filter((e) => official(lane(e.lane).finalMs!) === official(wt));
    if (tied.length > 1) out.push(`Dead heat for first: ${tied.map((e) => e.name).join(" and ")} in ${formatDuration(wt)}.`);
    else {
      out.push(`${w.name} won in ${formatDuration(wt)}.`);
      const second = finished[1];
      if (second) {
        const gap = official(lane(second.lane).finalMs!) - official(wt);
        out.push(gap <= 100 ? `A close finish: ${second.name} was ${formatDuration(gap)} behind.` : `${w.name} won by ${formatDuration(gap)} from ${second.name}.`);
      }
    }
    // negative split: the second half faster than the first
    const half = lane(w.lane).splits.find((x) => x.distance === r.distance / 2);
    if (half && wt - half.timeMs < half.timeMs) out.push(`${w.name} swam a negative split: ${formatDuration(half.timeMs)} then ${formatDuration(wt - half.timeMs)}.`);
  }
  const reactions = r.entries.filter((e) => lane(e.lane)?.reactionMs != null).sort((x, y) => lane(x.lane).reactionMs! - lane(y.lane).reactionMs!);
  if (reactions[0]) out.push(`Fastest reaction off the blocks: ${reactions[0].name} (${formatDuration(lane(reactions[0].lane).reactionMs!)}).`);
  for (const e of r.entries) {
    const l = lane(e.lane);
    if (l?.status === "dq") out.push(`${e.name} was disqualified${l.dqReason ? `: ${l.dqReason}` : ""}.`);
    if (l?.status === "dnf") out.push(`${e.name} did not finish.`);
  }
  if (s.falseStarts) out.push(`${s.falseStarts} false start${s.falseStarts === 1 ? "" : "s"} in this race.`);
  return out;
}
