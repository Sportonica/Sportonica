// Football Game IQ: the Laws of the Game (and the Futsal Laws) in words,
// from the competition's settings, and why the score did or did not change.

import type { SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import type { FootballRules, FootballState } from "../sports/football";

const unit = (r: FootballRules) => (r.periods === 2 ? "half" : "period");
const length = (r: FootballRules) => `${r.periods} ${unit(r)}s of ${r.periodMinutes} minutes${r.preset === "futsal" ? " (the clock stops when the ball is out of play)" : ""}`;
const decider = (r: FootballRules) => r.knockoutDecider === "extra_time_then_penalties" && r.extraTimeMinutes > 0
  ? `A knockout match level at full time goes to ${r.extraTimeMinutes}-minute halves of extra time, then a penalty shootout (${r.shootoutKicks} kicks each, then sudden death). League and group matches can end in a draw.`
  : `A knockout match level at full time goes straight to a penalty shootout (${r.shootoutKicks} kicks each, then sudden death). League and group matches can end in a draw.`;
const subs = (r: FootballRules) => r.maxSubstitutions === null
  ? "Rolling substitutions: players can come off and back on as often as the team likes."
  : `Each team may make ${plural(r.maxSubstitutions, "substitution")}; a player who comes off cannot return.`;
const cards = (r: FootballRules) => `A yellow card is a caution; ${r.yellowsForRed} yellows or a straight red sends a player off, and the team plays on with one player fewer.${r.preset === "futsal" ? " In futsal the team may bring on a replacement after two minutes or when it concedes." : ""}`;
const accumulated = (r: FootballRules) => r.accumulatedFoulLimit !== null
  ? `Team fouls are counted each half. From the ${r.accumulatedFoulLimit + 1}th foul in a half, every foul gives the other team a direct free kick from the second penalty mark with no wall.`
  : null;

export const FOOTBALL_KNOWLEDGE: SportKnowledge<FootballRules, FootballState> = {
  glossary: [
    { term: "Offside", meaning: "An attacker is offside if, when a team mate passes to them, they are in the opponents' half and nearer the goal line than both the ball and the second-last defender. It is a free kick to the defence. (Futsal has no offside.)" },
    { term: "Penalty", aliases: ["penalty kick", "spot kick"], meaning: "A direct free kick from the penalty mark, awarded for a foul by a defender in their own penalty area. Only the goalkeeper may defend it." },
    { term: "Direct free kick", aliases: ["free kick"], meaning: "A free kick that can be scored straight into the goal, given for most fouls. An indirect free kick must touch another player first." },
    { term: "Accumulated fouls", aliases: ["second penalty mark", "10 metre penalty", "sixth foul"], meaning: "Futsal: team fouls are counted each half; from the sixth, every foul gives a free shot from the second penalty mark (10 m) with no wall." },
    { term: "Kick-in", meaning: "Futsal's restart when the ball crosses the touchline, taken with the foot instead of a throw-in." },
    { term: "Corner", aliases: ["corner kick"], meaning: "A restart from the corner arc after the defending team last touched the ball over its own goal line." },
    { term: "Own goal", aliases: ["og"], meaning: "A goal a player puts into their own net. It counts for the other team." },
    { term: "Assist", meaning: "The pass (or touch) that sets up a goal." },
    { term: "Brace", aliases: ["hat-trick", "hat trick"], meaning: "A brace is two goals by one player in a match; a hat-trick is three." },
    { term: "Clean sheet", meaning: "A match in which a team does not concede a goal." },
    { term: "Yellow card", aliases: ["booking", "caution"], meaning: "A caution. A second yellow in the same match is a red." },
    { term: "Red card", aliases: ["sending off", "sent off"], meaning: "The player must leave the field and cannot be replaced; the team plays one short." },
    { term: "Extra time", aliases: ["a.e.t.", "aet"], meaning: "Two extra periods played when a knockout match is level at full time." },
    { term: "Penalty shootout", aliases: ["shootout", "penalties"], meaning: "Each team takes kicks from the penalty mark in turn; the most scored after five each wins, then sudden death." },
    { term: "Possession", meaning: "Each team's share of the ball. Sportonica estimates it from the share of recorded passes, and only shows it when passes were recorded." },
    { term: "Shot on target", aliases: ["on target"], meaning: "A shot that would have gone in without the goalkeeper's save (goals count as on target)." },
    { term: "Conversion rate", aliases: ["conversion"], meaning: "Goals scored as a share of shots taken." },
    { term: "Advantage", meaning: "The referee lets play continue after a foul when stopping it would hurt the fouled team." },
    { term: "Handball", meaning: "Deliberately handling the ball, or making the body unnaturally bigger with the arm. A free kick, or a penalty inside the area." },
    { term: "Expected goals", aliases: ["xg"], meaning: "A measure of chance quality from shot location and type. Sportonica does not calculate it: shots are not recorded with locations." },
  ],
  rules: (r) => [
    { re: /how many players/, answer: `${r.playersOnPitch} players a side on the pitch, including the goalkeeper. A team needs at least ${r.minPlayers} to play on.` },
    { re: /how long|how many minutes|how many halves/, answer: `${length(r)}.${r.extraTimeMinutes && r.knockoutDecider === "extra_time_then_penalties" ? ` Extra time is two halves of ${r.extraTimeMinutes} minutes.` : ""}` },
    { re: /(what happens|what if|when).*(draw|level|tie|tied)|extra time|penalt(y|ies) shootout|shootout/, answer: decider(r) },
    { re: /substitut|subs\b|how many changes/, answer: subs(r) },
    { re: /yellow|red card|sent off|sending off|how many cards/, answer: cards(r) },
    { re: /accumulated|second penalty|sixth foul|team fouls/, answer: accumulated(r) ?? "This competition has no accumulated-foul rule." },
    { re: /timeout/, answer: r.timeoutsPerPeriod ? `Each team may call ${plural(r.timeoutsPerPeriod, "timeout")} of one minute in each half.` : "There are no timeouts in this competition." },
    { re: /offside/, answer: r.preset === "futsal" ? "Futsal has no offside rule." : "An attacker is offside if they are nearer the opponents' goal line than both the ball and the second-last defender when a team mate passes to them, in the opponents' half." },
    { re: /how (is|does) (a|the) (match|game) (won|end)|who wins/, answer: `The team with more goals wins. ${decider(r)}` },
  ],
  stats: [
    { re: /own goals?/, key: "ownGoals", label: "own goals" },
    { re: /\bassists?\b/, key: "assists", label: "assists" },
    { re: /shots? on target|on target/, key: "shotsOnTarget", label: "shots on target" },
    { re: /shot accuracy/, key: "shotAccuracy", label: "shot accuracy", format: "pct" },
    { re: /conversion/, key: "conversion", label: "conversion rate", format: "pct" },
    { re: /\bshots?\b/, key: "shots", label: "shots" },
    { re: /pass(ing)? accuracy|pass %|pass completion/, key: "passAccuracy", label: "pass accuracy", format: "pct" },
    { re: /key pass/, key: "keyPasses", label: "key passes" },
    { re: /\bpass(es)?\b/, key: "passes", label: "passes completed of attempted" },
    { re: /possession/, key: "possession", label: "possession (share of passes)", format: "pct" },
    { re: /yellow/, key: "yellowCards", label: "yellow cards" },
    { re: /\bred\b|sent off/, key: "redCards", label: "red cards" },
    { re: /\bcards?\b|booking/, key: "yellowCards", label: "yellow cards" },
    { re: /fouls? (won|drawn|suffered)|fouled/, key: "foulsDrawn", label: "fouls drawn" },
    { re: /\bfouls?\b/, key: "fouls", label: "fouls" },
    { re: /corners?/, key: "corners", label: "corners" },
    { re: /offsides?/, key: "offsides", label: "offsides" },
    { re: /saves?|goalkeeper/, key: "saves", label: "saves" },
    { re: /tackles?/, key: "tackles", label: "tackles" },
    { re: /interceptions?/, key: "interceptions", label: "interceptions" },
    { re: /minutes/, key: "min", label: "minutes played" },
    { re: /\bgoals?\b|scored|top scorer|scorers?/, key: "goals", label: "goals" },
  ],
  explain: (s) => s.recent.map((e) => ({ kind: e.kind, text: e.text })),
  guide: (r) => [
    { title: "The match", lines: [`${r.playersOnPitch} players a side.`, `${length(r)}.`, "The team with more goals wins."] },
    { title: "If it is level", lines: [decider(r)] },
    { title: "Fouls and cards", lines: [cards(r), ...(accumulated(r) ? [accumulated(r)!] : [])] },
    { title: "Substitutions and timeouts", lines: [subs(r), r.timeoutsPerPeriod ? `${plural(r.timeoutsPerPeriod, "timeout")} per team each half.` : "No timeouts."] },
    { title: "What the scorer records", lines: [
      "Goals (with scorer, assist and how), shots and where they went, fouls, cards, corners, offsides, substitutions.",
      "Passes, tackles and interceptions are optional: possession and pass accuracy appear only when passes are recorded.",
      "When the match is completed, the result and each player's goals, assists and cards go to the fixture and the tournament tables.",
    ] },
  ],
  suggestions: ["What is the score?", "Who has scored?", "How many shots on target?", "Why did the score change?", "What happens if it is level?"],
};
