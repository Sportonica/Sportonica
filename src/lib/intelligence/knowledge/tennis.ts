// Tennis Game IQ: ITF scoring in words, from the competition's settings,
// and why each point did what it did.

import type { Explanation, SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import { sideName } from "../core/util";
import type { TennisRules, TennisState } from "../sports/tennis";

const gameRule = (r: TennisRules) => r.noAd
  ? "Points go 0 (love), 15, 30, 40, game. At 40-40 (deuce) the next point wins the game: no-ad scoring, the receiver chooses the side to receive."
  : "Points go 0 (love), 15, 30, 40, game. At 40-40 (deuce) a player must win two points in a row: the first gives advantage, the second the game.";
const setRule = (r: TennisRules) => r.tiebreakAt !== null
  ? `A set goes to the first to ${r.gamesPerSet} games with a 2-game lead. At ${r.tiebreakAt}-all a tiebreak to ${r.tiebreakPoints} points (win by 2) decides it.`
  : `A set goes to the first to ${r.gamesPerSet} games with a 2-game lead, played out with no tiebreak.`;
const finalRule = (r: TennisRules) => r.finalSet === "match_tiebreak"
  ? `Instead of a deciding set, a match tiebreak to ${r.matchTiebreakPoints} points (win by 2) decides the match.`
  : r.finalSet === "advantage" ? "The deciding set has no tiebreak: it is played until a player leads by two games." : "The deciding set is played like the others, with a tiebreak.";
const matchRule = (r: TennisRules) => `Best of ${plural(r.bestOfSets, "set")}: the first to win ${Math.ceil(r.bestOfSets / 2)} wins.`;

const HOW: Record<string, string> = { ace: "an ace", double_fault: "a double fault", winner: "a winner", forced_error: "a forced error", unforced_error: "an unforced error" };

export const TENNIS_KNOWLEDGE: SportKnowledge<TennisRules, TennisState> = {
  glossary: [
    { term: "Love", meaning: "Zero. A love game is won without the opponent scoring a point." },
    { term: "Deuce", meaning: "40-40. A player then needs two points in a row to win the game (or, with no-ad scoring, the next point)." },
    { term: "Advantage", aliases: ["ad", "ad in", "ad out"], meaning: "The point after deuce: win the next point and you win the game, lose it and it is back to deuce." },
    { term: "Break", aliases: ["break of serve", "broke serve"], meaning: "Winning a game on the opponent's serve." },
    { term: "Break point", aliases: ["break points"], meaning: "A point that, if the receiver wins it, wins the game: a chance to break serve." },
    { term: "Hold", aliases: ["hold serve", "held serve"], meaning: "Winning your own service game." },
    { term: "Tiebreak", aliases: ["tie-break", "tie break"], meaning: "A deciding game at 6-all, counted 1, 2, 3; first to 7 points with a 2-point lead wins the set 7-6." },
    { term: "Match tiebreak", aliases: ["super tiebreak", "champions tiebreak"], meaning: "A tiebreak to 10 points (win by 2) played instead of a deciding set." },
    { term: "Ace", aliases: ["aces"], meaning: "A legal serve the receiver does not touch: a point to the server." },
    { term: "Double fault", aliases: ["double faults"], meaning: "Missing both the first and second serve: a point to the receiver." },
    { term: "Fault", meaning: "A serve that misses the service box or hits the net and drops on the server's side." },
    { term: "Let", meaning: "A serve that clips the net and lands in: it is replayed." },
    { term: "Winner", aliases: ["winners"], meaning: "A shot the opponent cannot reach or touch." },
    { term: "Unforced error", aliases: ["unforced errors"], meaning: "A missed shot that was the player's own mistake, not caused by the opponent." },
    { term: "Forced error", aliases: ["forced errors"], meaning: "A missed shot caused by the opponent's pressure." },
    { term: "Set point", aliases: ["match point", "championship point"], meaning: "A point that wins the set (or the match) for the leading player if they win it." },
    { term: "Bagel", aliases: ["breadstick"], meaning: "A 6-0 set; a breadstick is 6-1." },
    { term: "No-ad", aliases: ["no ad", "deciding point", "no-advantage"], meaning: "At deuce the next point wins the game." },
    { term: "First serve percentage", aliases: ["first serve %", "1st serve %"], meaning: "Share of service points where the first serve went in." },
    { term: "Rally", meaning: "The exchange of shots in a point." },
  ],
  rules: (r) => [
    { re: /how (does|do) (the )?(scoring|points) work|why (15|fifteen)|what comes after|15.?30.?40/, answer: gameRule(r) },
    { re: /deuce|advantage|no.?ad|deciding point/, answer: gameRule(r) },
    { re: /how many games|win a set|how (is|does) a set/, answer: setRule(r) },
    { re: /tie.?break/, answer: `${setRule(r)} In a tiebreak the first point is served by the next server, then players serve two points each.${r.finalSet === "match_tiebreak" ? ` ${finalRule(r)}` : ""}` },
    { re: /how many sets|best of|win (the|a) match/, answer: `${matchRule(r)} ${finalRule(r)}` },
    { re: /final set|deciding set|third set|fifth set/, answer: finalRule(r) },
    { re: /who serves|serve next|change serve|switch serve/, answer: "Players alternate serving each game. In a tiebreak the next server serves one point, then the serve changes every two points. After a tiebreak, the player who received first in it serves the next set." },
    { re: /singles or doubles|format/, answer: `This competition is ${r.format}.` },
  ],
  stats: [
    { re: /double faults?/, key: "doubleFaults", label: "double faults" },
    { re: /\baces?\b/, key: "aces", label: "aces" },
    { re: /first serve (points )?won|1st serve (points )?won/, key: "firstServeWonPct", label: "of first-serve points won", format: "pct" },
    { re: /second serve|2nd serve/, key: "secondServeWonPct", label: "of second-serve points won", format: "pct" },
    { re: /first serve|1st serve/, key: "firstServePct", label: "first serves in", format: "pct" },
    { re: /break points? (saved|faced)/, key: "breakPointsSaved", label: "break points saved" },
    { re: /break point conversion|converted/, key: "breakPointConversion", label: "break point conversion", format: "pct" },
    { re: /break points?|breaks of serve|broke/, key: "breakPoints", label: "break points won" },
    { re: /held|hold/, key: "serviceGamesHeld", label: "service games held" },
    { re: /return points?/, key: "returnPointsWonPct", label: "of return points won", format: "pct" },
    { re: /unforced errors?/, key: "unforcedErrors", label: "unforced errors" },
    { re: /forced errors?/, key: "forcedErrors", label: "forced errors" },
    { re: /\bwinners\b/, key: "winners", label: "winners" },
    { re: /tiebreaks? won/, key: "tiebreaksWon", label: "tiebreaks won" },
    { re: /in a row|streak/, key: "longestStreak", label: "points in a row (most)" },
    { re: /games won|how many games/, key: "gamesWon", label: "games won" },
    { re: /points? won|how many points/, key: "pointsWon", label: "points won" },
  ],
  explain: (s, ctx) => s.points.slice(-12).map((p): Explanation => {
    const how = p.how && p.how !== "other" ? ` with ${HOW[p.how]}` : "";
    const where = p.tiebreak ? "in the tiebreak" : p.breakPoint ? "on a break point" : "";
    return {
      kind: "score",
      text: `${sideName(ctx, p.w)} won the point${how}${where ? ` ${where}` : ""}${p.w === p.srv ? " on serve" : " on return"}. ${p.call}.`,
    };
  }),
  guide: (r) => [
    { title: "Points and games", lines: [gameRule(r)] },
    { title: "Sets", lines: [setRule(r)] },
    { title: "Match", lines: [matchRule(r), finalRule(r), `Format: ${r.format}.`] },
    { title: "Serving", lines: ["Players alternate serving each game.", "In a tiebreak the serve changes after the first point, then every two points."] },
    { title: "What the scorer records", lines: ["Who won each point, and optionally how (ace, double fault, winner, forced or unforced error) and which serve was in.", "The engine calls the score (15, 30, 40, deuce), games, sets, tiebreaks and break points."] },
  ],
  suggestions: ["What is the score?", "How many aces?", "What is a break point?", "Why did the score change?", "How does a tiebreak work?"],
};
