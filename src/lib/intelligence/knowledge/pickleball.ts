// Pickleball Game IQ: side-out or rally scoring in words, from the settings.

import type { SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import type { PickleballRules, PickleballState } from "../sports/pickleball";
import { RALLY_STATS, rallyExplanations } from "./rally";

const gameRule = (r: PickleballRules) =>
  `A game goes to ${r.pointsToWin} points with a ${r.winBy}-point lead${r.pointCap !== null ? ` (capped at ${r.pointCap})` : ""}.`;
const scoringRule = (r: PickleballRules) => r.scoring === "rally"
  ? "Rally scoring: every rally scores a point for whoever wins it."
  : `Side-out scoring: only the serving side can score. If the serving side loses the rally, ${r.format === "doubles" ? "the serve passes to their second server, then to the other team (a side out)" : "the serve passes to the opponent (a side out)"}.`;
const matchRule = (r: PickleballRules) => r.bestOfSets > 1
  ? `Best of ${plural(r.bestOfSets, "set")}, each set best of ${plural(r.bestOfGames, "game")}.`
  : `Best of ${plural(r.bestOfGames, "game")}: the first to ${Math.ceil(r.bestOfGames / 2)} wins.`;

export const PICKLEBALL_KNOWLEDGE: SportKnowledge<PickleballRules, PickleballState> = {
  glossary: [
    { term: "Side out", aliases: ["sideout"], meaning: "The serve passes to the other team because the serving team lost the rally (in doubles, after both servers have lost it)." },
    { term: "Kitchen", aliases: ["non-volley zone", "nvz"], meaning: "The 7-foot zone on each side of the net. You may not volley (hit the ball out of the air) while standing in it." },
    { term: "Two-bounce rule", aliases: ["double bounce rule", "two bounce"], meaning: "After the serve, the ball must bounce once on each side before anyone may volley it." },
    { term: "Dink", meaning: "A soft shot from near the kitchen line that lands in the opponent's kitchen." },
    { term: "Third shot drop", aliases: ["third-shot drop"], meaning: "A soft shot by the serving team on the third shot, dropping into the kitchen so they can move up to the net." },
    { term: "Volley", meaning: "Hitting the ball before it bounces." },
    { term: "Score call", aliases: ["0-0-2", "zero zero two"], meaning: "In doubles the server calls three numbers: serving team's score, receiving team's score, and server number (1 or 2). Games start at 0-0-2." },
    { term: "Second server", aliases: ["server number"], meaning: "In doubles each player on the serving team serves until they lose a rally; when the second server loses, it is a side out." },
    { term: "Service fault", aliases: ["fault"], meaning: "A serve that is illegal, hits the net or lands out. The serving side loses the rally." },
    { term: "Ace", meaning: "A serve the receiver cannot return." },
    { term: "Unforced error", meaning: "A rally lost to the player's own mistake." },
    { term: "Erne", meaning: "A volley hit from outside the court beside the kitchen, legal as long as the player does not touch the kitchen." },
  ],
  rules: (r) => [
    { re: /how many points|points to win|win a game|game (to|is) \d+/, answer: `${gameRule(r)} ${scoringRule(r)}` },
    { re: /side ?out|only (the )?serv|can the receiving|does the receiving|who (can )?scores?/, answer: scoringRule(r) },
    { re: /how many games|best of|win (the|a) match/, answer: matchRule(r) },
    { re: /score call|call the score|0-0-2|three numbers|server number/, answer: r.format === "doubles" && r.scoring === "side_out" ? "Call serving score, receiving score, then server number (1 or 2). Each game starts at 0-0-2: only one server serves at the start." : "Call the serving side's score first, then the receiving side's." },
    { re: /who serves (next|first)|next game.*serve|serve.*next game/, answer: `In the next game the serve goes to ${r.nextGameServe === "alternate" ? "the team that did not serve first in the last game" : r.nextGameServe === "winner" ? "the winner of the last game" : "the loser of the last game"}.` },
  ],
  stats: [
    { re: /service faults?|faults?/, key: "serviceFaults", label: "service faults" },
    { re: /games won|how many games/, key: "gamesWon", label: "games won" },
    ...RALLY_STATS,
  ],
  explain: (s, ctx) => rallyExplanations(s.rallies, ctx, {
    unit: (g) => `game ${g + 1}`,
    how: { ace: "an ace", winner: "a winner", unforced_error: "an unforced error", service_fault: "a service fault" },
    sideOut: () => "The serve moves on (to the second server, or to the other team).",
  }),
  guide: (r) => [
    { title: "Points", lines: [scoringRule(r), gameRule(r)] },
    { title: "Match", lines: [matchRule(r), `Format: ${r.format}.`] },
    { title: "Serving", lines: r.format === "doubles" && r.scoring === "side_out"
      ? ["Each game starts at 0-0-2: only one player serves before the first side out.", "After that, both partners serve in turn before the serve passes to the other team."]
      : ["The server keeps serving while their side wins rallies."] },
    { title: "What the scorer records", lines: ["Who won each rally, and optionally how: ace, winner, unforced error, service fault.", "The engine works out points, side outs and server numbers."] },
  ],
  suggestions: ["What is the score?", "What is a side out?", "Why didn't the score change?", "Who has the most aces?", "What is the kitchen?"],
};
