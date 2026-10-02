// Badminton Game IQ: BWF scoring in words, from the competition's settings.

import type { SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import type { BadmintonRules, BadmintonState } from "../sports/badminton";
import { RALLY_STATS, rallyExplanations, rallyInsights } from "./rally";

const winGames = (r: BadmintonRules) => Math.ceil(r.bestOf / 2);
const gameRule = (r: BadmintonRules) =>
  `A game goes to the first side to ${r.pointsToWin} points with a ${r.winBy}-point lead${r.pointCap !== null ? `; if it reaches ${r.pointCap - 1}-all, the first to ${r.pointCap} wins` : ""}.`;

export const BADMINTON_KNOWLEDGE: SportKnowledge<BadmintonRules, BadmintonState> = {
  glossary: [
    { term: "Rally point scoring", aliases: ["rally scoring"], meaning: "Every rally scores a point for whoever wins it, whether they served or not." },
    { term: "Service court", aliases: ["right court", "left court"], meaning: "The server serves from the right court when their score is even and the left when it is odd, diagonally to the receiver." },
    { term: "Fault", aliases: ["faults"], meaning: "A rule broken during play, such as the shuttle landing out, hitting the net, or a foot fault on serve. The other side wins the rally." },
    { term: "Let", meaning: "A rally that is stopped and replayed with no point, for example if the receiver was not ready." },
    { term: "Smash", meaning: "A powerful downward overhead shot, the main attacking stroke." },
    { term: "Clear", aliases: ["lob"], meaning: "A high, deep shot to the back of the opponent's court." },
    { term: "Drop shot", aliases: ["drop"], meaning: "A soft shot that falls just over the net." },
    { term: "Net shot", aliases: ["net kill", "net winner"], meaning: "A delicate shot played close to the net, or a quick kill of a loose shuttle there." },
    { term: "Drive", meaning: "A fast, flat shot that travels just over the net." },
    { term: "Setting", aliases: ["deuce", "20-all", "20 all"], meaning: "When a game reaches 20-all, a side needs a 2-point lead, up to a cap of 30 points." },
    { term: "Ace", meaning: "A serve the receiver cannot return." },
    { term: "Service error", aliases: ["service fault"], meaning: "A serve that is illegal or lands out. The receiving side wins the rally and the point." },
    { term: "Unforced error", meaning: "A rally lost to the player's own mistake rather than the opponent's pressure." },
    { term: "Interval", meaning: "A short break when the leading side reaches 11 points in a game, and between games." },
    { term: "Game point", aliases: ["match point"], meaning: "A rally that, if won by the leading side, wins the game (or the match)." },
  ],
  rules: (r) => [
    { re: /how many points|points to win|win a game|how (is|does) a game|game (to|is) \d+/, answer: `${gameRule(r)} Every rally scores a point.` },
    { re: /how many games|best of|win (the|a) match|how (is|does) (the|a) match/, answer: `The match is best of ${plural(r.bestOf, "game")}: the first to win ${winGames(r)} wins.` },
    { re: /deuce|setting|20.?all|29.?all|cap\b/, answer: r.pointCap !== null ? `From ${r.pointsToWin - 1}-all a side needs a ${r.winBy}-point lead, but at ${r.pointCap - 1}-all the next point wins (${r.pointCap} is the cap).` : `From ${r.pointsToWin - 1}-all a side needs a ${r.winBy}-point lead, with no cap.` },
    { re: /who serves|serve (next|first)|which court|serve from|serving side/, answer: "The side that won the last rally serves next. The server serves from the right court on an even score and the left on an odd score." },
    { re: /does (a|the) (losing|receiving) side score|only (the )?server|side ?out/, answer: "Badminton uses rally point scoring: every rally gives a point to whoever wins it, serving or not." },
    { re: /singles or doubles|format/, answer: `This competition is ${r.format}.` },
  ],
  stats: [
    { re: /smash/, key: "smashWinners", label: "smash winners" },
    { re: /net (winners?|kills?|shots?)/, key: "netWinners", label: "net winners" },
    { re: /service errors?|service faults?/, key: "serviceErrors", label: "service errors" },
    { re: /defensive/, key: "defensivePoints", label: "defensive points" },
    { re: /games won|how many games/, key: "gamesWon", label: "games won" },
    ...RALLY_STATS,
  ],
  explain: (s, ctx) => rallyExplanations(s.rallies, ctx, {
    unit: (g) => `game ${g + 1}`,
    how: { ace: "an ace", service_error: "a service error", winner: "a winner", smash_winner: "a smash winner", net_winner: "a net winner", unforced_error: "an unforced error", defensive: "a defensive point" },
  }),
  guide: (r) => [
    { title: "Points", lines: ["Every rally scores one point for the side that wins it (rally point scoring).", gameRule(r)] },
    { title: "Match", lines: [`Best of ${plural(r.bestOf, "game")}: the first side to ${winGames(r)} wins the match.`, `Format: ${r.format}.`] },
    { title: "Serving", lines: ["The side that won the last rally serves next.", "Serve from the right court on an even score, from the left on an odd score, diagonally to the receiver."] },
    { title: "What the scorer records", lines: ["Who won each rally, and optionally how: ace, service error, winner, smash, net winner, unforced error, defensive point.", "Shot count per rally if you want rally-length statistics."] },
  ],
  insights: (s, ctx) => rallyInsights(s.rallies, ctx, {
    unit: "game", games: s.games, won: s.gamesWon, decided: s.decided, team: s.team,
    counts: [["smashWinners", "hit more smash winners"], ["aces", "served more aces"], ["unforcedErrors", "made more unforced errors"], ["serviceErrors", "made more service errors"]],
  }),
  suggestions: ["What is the score?", "How many points win a game?", "Who has the most smash winners?", "Why did the score change?", "What is setting?"],
};
