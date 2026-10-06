// Volleyball Game IQ: FIVB rally scoring in words, from the settings.

import type { SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import type { VolleyballRules, VolleyballState } from "../sports/volleyball";
import { RALLY_STATS, rallyExplanations, rallyInsights } from "./rally";

const setRule = (r: VolleyballRules) =>
  `A set goes to the first team to ${r.setPoints} points with a ${r.winBy}-point lead${r.bestOf > 1 ? `; the deciding set ${r.bestOf} goes to ${r.decidingSetPoints}` : ""}${r.pointCap !== null ? `, capped at ${r.pointCap}` : ""}.`;

export const VOLLEYBALL_KNOWLEDGE: SportKnowledge<VolleyballRules, VolleyballState> = {
  glossary: [
    { term: "Rally scoring", aliases: ["rally point"], meaning: "Every rally scores a point for the team that wins it, serving or not." },
    { term: "Side-out", aliases: ["side out", "sideout"], meaning: "Winning a rally on the opponent's serve: you score and take the serve." },
    { term: "Rotation", aliases: ["rotate"], meaning: "When a team wins back the serve, its players move one position clockwise; the player moving to position 1 serves." },
    { term: "Kill", aliases: ["kills"], meaning: "An attack that wins the rally outright." },
    { term: "Block", aliases: ["blocks", "stuff block"], meaning: "Players at the net stop an attack; a block point is one that wins the rally." },
    { term: "Dig", aliases: ["digs"], meaning: "Keeping an attacked ball off the floor, usually with the forearms." },
    { term: "Ace", meaning: "A serve that wins the rally directly." },
    { term: "Set", aliases: ["setter", "assist"], meaning: "The second touch, placing the ball for an attacker. A set that leads to a kill is an assist." },
    { term: "Libero", meaning: "A defensive specialist in a different shirt who may replace back-row players freely but may not attack above the net or serve (in most rules)." },
    { term: "Reception", aliases: ["pass", "serve receive"], meaning: "The first touch on the opponent's serve." },
    { term: "Attack error", meaning: "An attack that goes out, into the net, or is otherwise lost." },
    { term: "Attack percentage", aliases: ["hitting percentage", "attack %"], meaning: "(Kills minus attack errors) divided by attack attempts." },
    { term: "Four hits", aliases: ["three touches"], meaning: "A team may touch the ball at most three times before it goes over (a block does not count)." },
  ],
  rules: (r) => [
    { re: /how many points|points to win|win a set|set (to|is) \d+/, answer: `${setRule(r)} Every rally scores a point.` },
    { re: /how many sets|best of|win (the|a) match/, answer: `Best of ${plural(r.bestOf, "set")}: the first to ${Math.ceil(r.bestOf / 2)} wins.` },
    { re: /deciding set|fifth set|tie.?break/, answer: `The deciding set goes to ${r.decidingSetPoints} points with a ${r.winBy}-point lead.` },
    { re: /how many timeouts/, answer: `${plural(r.timeoutsPerSet, "timeout")} per team in each set.` },
    { re: /how many (substitutions|subs)/, answer: `${plural(r.substitutionsPerSet, "substitution")} per team in each set.` },
    { re: /how many players/, answer: `${r.playersOnCourt} per team on court.` },
    { re: /who serves|serve next|rotation|rotate/, answer: "The team that won the last rally serves. A team that wins the serve back rotates one position clockwise before serving." },
  ],
  stats: [
    { re: /kill %|kill percentage/, key: "killPct", label: "kill percentage", format: "pct" },
    { re: /attack %|attack percentage|hitting percentage|hitting/, key: "attackPct", label: "attack percentage", format: "pct" },
    { re: /attack errors?/, key: "attackErrors", label: "attack errors" },
    { re: /\bkills?\b/, key: "kills", label: "kills" },
    { re: /\bblocks?\b|block points/, key: "blocks", label: "block points" },
    { re: /\bdigs?\b/, key: "digs", label: "digs" },
    { re: /\bassists?\b|\bsets\b given/, key: "assists", label: "assists" },
    { re: /reception errors?/, key: "receptionErrors", label: "reception errors" },
    { re: /reception (efficiency|%)/, key: "receptionEff", label: "reception efficiency", format: "pct" },
    { re: /receptions?|passes/, key: "receptions", label: "receptions" },
    { re: /service errors?/, key: "serviceErrors", label: "service errors" },
    { re: /side.?out %|side.?out percentage/, key: "sideOutPct", label: "side-out percentage", format: "pct" },
    { re: /sets won|how many sets/, key: "setsWon", label: "sets won" },
    ...RALLY_STATS,
  ],
  explain: (s, ctx) => rallyExplanations(s.rallies, ctx, {
    unit: (g) => `set ${g + 1}`,
    how: { ace: "an ace", kill: "a kill", block: "a block", service_error: "a service error", attack_error: "an attack error", opponent_error: "an opponent error" },
  }),
  guide: (r) => [
    { title: "Points", lines: ["Every rally scores one point for the team that wins it (rally scoring).", setRule(r)] },
    { title: "Match", lines: [`Best of ${plural(r.bestOf, "set")}: the first team to ${Math.ceil(r.bestOf / 2)} wins.`] },
    { title: "Serving and rotation", lines: ["The team that won the last rally serves.", "A team that wins the serve back rotates one position clockwise first."] },
    { title: "Limits", lines: [`${r.playersOnCourt} players on court, ${plural(r.timeoutsPerSet, "timeout")} and ${plural(r.substitutionsPerSet, "substitution")} per team per set.`] },
    { title: "What the scorer records", lines: ["Who won each rally, and optionally how: ace, kill, block, service error, attack error, opponent error.", "Touches (attacks, digs, assists, receptions) for player statistics."] },
  ],
  insights: (s, ctx) => rallyInsights(s.rallies, ctx, {
    unit: "set", games: s.sets, won: s.setsWon, decided: s.decided, team: s.team,
    counts: [["kills", "had more kills"], ["blocks", "won more points at the block"], ["aces", "served more aces"], ["serviceErrors", "made more service errors"], ["attackErrors", "made more attack errors"]],
  }),
  suggestions: ["What is the score?", "Who has the most kills?", "How many points win a set?", "Why did the score change?", "What is a libero?"],
};
