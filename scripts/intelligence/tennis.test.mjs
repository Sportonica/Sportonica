import assert from "node:assert/strict";
import { tennisEngine as E, pointCall } from "../../src/lib/intelligence/sports/tennis.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { makeContext, openMatch, section, cell } from "./harness.mjs";

const singles = makeContext("tennis", 1);
const doubles = makeContext("tennis", 2);
const point = (m, side, extra = {}) => m.push("POINT_WON", { side, ...extra });
const points = (m, side, n) => { for (let i = 0; i < n; i++) point(m, side); };
const call = (m) => pointCall(m.env.sport, m.ctx, m.rules);
const set = (m) => m.env.sport.sets[m.env.sport.sets.length - 1];
// every game to its server until games-all: g games each
const holdsTo = (m, g) => { for (let i = 0; i < 2 * g; i++) points(m, m.env.sport.serving, 4); };
const start = (ctx = singles, rules = {}) => { const m = openMatch(E, ctx, rules); m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" }); return m; };

section("tennis: 0, 15, 30, 40, game; the serve changes each game", () => {
  const m = openMatch(E, singles);
  m.push("MATCH_START");
  m.refuses("POINT_WON", { side: "a" }, /who serves first/, "a point before the first server");
  m.push("FIRST_SERVE", { side: "a" });
  assert.equal(call(m), "0-0");
  point(m, "a"); assert.equal(call(m), "15-0");
  point(m, "b"); assert.equal(call(m), "15-15");
  point(m, "a"); point(m, "a"); assert.equal(call(m), "40-15");
  point(m, "a");
  assert.deepEqual(set(m).games, { a: 1, b: 0 });
  assert.equal(m.env.sport.serving, "b", "the receiver serves the next game");
  assert.equal(call(m), "0-0", "called from the server's side");
  point(m, "a");
  assert.equal(call(m), "0-15");
});

section("tennis: deuce and advantage, or a deciding point with no-ad", () => {
  const m = start();
  points(m, "a", 3); points(m, "b", 3);
  assert.equal(call(m), "Deuce");
  point(m, "a"); assert.equal(call(m), "Advantage Alpha");
  point(m, "b"); assert.equal(call(m), "Deuce", "back to deuce");
  point(m, "b"); assert.equal(call(m), "Advantage Bravo");
  assert.match(m.summary().view.notes.join(" "), /Break point/, "advantage receiver is a break point");
  point(m, "b");
  assert.deepEqual(set(m).games, { a: 0, b: 1 }, "two points in a row after deuce");
  assert.equal(m.env.sport.team.b.breaks, 1);

  const noAd = start(singles, { noAd: true });
  points(noAd, "a", 3); points(noAd, "b", 3);
  assert.equal(call(noAd), "Deuce (deciding point)");
  point(noAd, "a");
  assert.deepEqual(set(noAd).games, { a: 1, b: 0 }, "no-ad: the next point wins");
  assert.equal(noAd.env.sport.team.a.decidingPointsWon, 1);
});

section("tennis: break points, holds and breaks", () => {
  const m = start();
  points(m, "b", 3);                                  // 0-40: three break points
  assert.match(m.summary().view.notes.join(" "), /Break point/);
  points(m, "a", 5);                                  // 15-40, 30-40, deuce, advantage, game: saved them all and held
  const t = m.env.sport.team;
  assert.deepEqual([t.b.breakPointChances, t.b.breakPointsWon ?? 0, t.a.breakPointsFaced, t.a.breakPointsSaved], [3, 0, 3, 3], "0-40, 15-40 and 30-40; then deuce and advantage server are not break points");
  assert.deepEqual([t.a.serviceGames, t.a.serviceGamesWon], [1, 1]);
  points(m, "a", 4);                                  // Alpha breaks Bravo to love
  assert.equal(m.env.sport.team.a.breaks, 1);
  const stats = m.stats().teams;
  assert.equal(cell(stats, "team", "a", "breakPoints"), "1/1");
  assert.equal(cell(stats, "team", "a", "breakPointsSaved"), "3/3");
  assert.equal(cell(stats, "team", "b", "serviceGamesHeld"), "0/1");
});

section("tennis: a set to 6 with a 2-game lead, a tiebreak at 6-all", () => {
  const m = start();
  holdsTo(m, 5);
  assert.deepEqual(set(m).games, { a: 5, b: 5 });
  points(m, "a", 4); points(m, "a", 4);               // Alpha holds, then breaks: 7-5
  assert.equal(m.env.sport.sets[0].winner, "a", "7-5: two games clear");

  const tb = start();
  holdsTo(tb, 6);
  assert.equal(tb.env.sport.inTiebreak, true, "6-6: tiebreak");
  assert.equal(tb.env.sport.serving, "a", "the next server serves the first tiebreak point");
  // serve order in a tiebreak: A, B, B, A, A, B, B ...
  const order = [];
  const seq = ["a", "b", "a", "b", "a", "b", "a", "b", "a", "a", "a", "a"];
  for (const w of seq) { order.push(tb.env.sport.serving); point(tb, w); if (!tb.env.sport.inTiebreak) break; }
  assert.deepEqual(order.slice(0, 7), ["a", "b", "b", "a", "a", "b", "b"]);
  const first = tb.env.sport.sets[0];
  assert.equal(first.winner, "a");
  assert.deepEqual([first.games.a, first.games.b, first.tiebreak.a, first.tiebreak.b], [7, 6, 7, 4], "7-6(4)");
  assert.equal(tb.env.sport.serving, "b", "after a tiebreak the player who received first serves");
  assert.match(tb.summary().view.brief, /^7-6\(4\)/);
  assert.equal(tb.env.sport.team.a.tiebreaksWon, 1);
  tb.assertReconstructs("tiebreak");
});

section("tennis: best of three, completion, and nothing after the match is won", () => {
  const m = start();
  for (let s = 0; s < 2; s++) for (let g = 0; g < 6; g++) points(m, "a", 4);
  assert.equal(m.env.sport.decided, "a");
  m.refuses("POINT_WON", { side: "b" }, /have won the match/, "a point after the match is won");
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "6-0, 6-0" });
  assert.deepEqual(E.mirrorScore(m.env.sport, singles, m.rules), { scoreA: 2, scoreB: 0 }, "the fixture shows sets won");

  const early = start();
  points(early, "a", 4);
  early.refuses("MATCH_COMPLETE", {}, /not decided yet/, "completing an unfinished match");
});

section("tennis: an advantage final set, or a match tiebreak instead of it", () => {
  const adv = start(singles, { finalSet: "advantage" });
  for (let g = 0; g < 6; g++) points(adv, "a", 4);   // set 1 to Alpha
  for (let g = 0; g < 6; g++) points(adv, "b", 4);   // set 2 to Bravo
  holdsTo(adv, 6);
  assert.equal(adv.env.sport.inTiebreak, false, "no tiebreak in an advantage final set");
  holdsTo(adv, 1);
  assert.deepEqual(set(adv).games, { a: 7, b: 7 });
  points(adv, adv.env.sport.serving, 4);
  points(adv, adv.env.sport.serving === "a" ? "b" : "a", 4);   // the receiver breaks: 9-7 or 7-9
  assert.ok(adv.env.sport.decided, "won by two games");

  const mtb = start(doubles, { preset: "doubles_pro" });
  for (let g = 0; g < 6; g++) points(mtb, "a", 4);
  for (let g = 0; g < 6; g++) points(mtb, "b", 4);
  assert.equal(set(mtb).matchTiebreak, true, "at one set all: a match tiebreak");
  assert.equal(mtb.env.sport.inTiebreak, true);
  points(mtb, "a", 9); points(mtb, "b", 9);
  assert.equal(mtb.env.sport.decided, null, "9-9: win by two");
  points(mtb, "b", 2);
  assert.equal(mtb.env.sport.decided, "b");
  mtb.push("MATCH_COMPLETE");
  assert.equal(mtb.env.result.margin, "0-6, 6-0, [11-9]", "set scores from the winner's side");
  mtb.assertReconstructs("match tiebreak");
});

section("tennis: impossible points are refused", () => {
  const m = start(doubles);
  m.refuses("POINT_WON", { side: "b", how: "ace" }, /Only the server/, "an ace by the receiver");
  m.refuses("POINT_WON", { side: "a", how: "double_fault" }, /loses the point for the server/, "a double fault won by the server");
  m.refuses("POINT_WON", { side: "b", how: "double_fault", serve: 2 }, /no serve in/, "a double fault with a serve in");
  m.refuses("POINT_WON", { side: "a", serve: 3 }, /serve must be 1/, "a third serve");
  m.refuses("POINT_WON", { side: "a", how: "winner", player: "b1" }, /not in Alpha/, "a winner credited to the opponent");
  m.refuses("POINT_WON", { side: "a", how: "unforced_error", player: "a1" }, /error must be in Bravo/, "Alpha's point from Alpha's own error");
  m.refuses("POINT_WON", { side: "a", how: "lucky_net" }, /Unknown way/, "a made-up way to win");
});

section("tennis: serve statistics count only recorded serves", () => {
  const m = start();
  point(m, "a", { how: "ace", serve: 1, player: "a1" });
  point(m, "a", { serve: 1 });
  point(m, "b", { serve: 2 });
  point(m, "b", { how: "double_fault", player: "a1" });
  point(m, "a");                                       // serve not recorded
  const t = m.stats().teams;
  assert.equal(cell(t, "team", "a", "aces"), 1);
  assert.equal(cell(t, "team", "a", "doubleFaults"), 1);
  assert.equal(cell(t, "team", "a", "firstServePct"), 50, "2 first serves in out of 4 recorded serves");
  assert.equal(cell(t, "team", "a", "firstServeWonPct"), 100);
  assert.equal(cell(t, "team", "a", "secondServeWonPct"), 0, "a second-serve point lost, and a double fault");
  assert.equal(cell(t, "team", "a", "servicePointsWonPct"), 60, "3 of 5 service points");
  assert.equal(cell(m.stats().players, "players", "a1", "aces"), 1);
  const line = m.stats().lines.find((l) => l.subject === "team" && l.side === "a").raw;
  const season = aggregate(E, "team", [line, line]);
  assert.equal(season.values.firstServePct, 50, "percentages from summed counters");
  assert.equal(season.values.acesPerMatch, 1);
});

section("tennis: Game IQ answers from the match and the competition's rules", () => {
  const m = start();
  point(m, "a", { how: "ace", player: "a1" });
  point(m, "b", { how: "winner", player: "b1" });
  const ask = (q) => E.answerQuestion(m.env.sport, singles, m.rules, q);
  assert.match(ask("What is the score?").answer, /Alpha 0, Bravo 0 \(Set 1, Alpha serving\)/);
  assert.match(ask("How many aces does Alpha 1 have?").answer, /Alpha 1: 1 aces/);
  assert.equal(ask("Why did the score change?").answer, "Bravo won the point with a winner on return. 15-15.");
  assert.match(ask("What is a break point?").answer, /^Break point: /);
  assert.match(ask("How does a tiebreak work?").answer, /At 6-all a tiebreak to 7 points/);
  assert.match(ask("How many sets win the match?").answer, /Best of 3 sets: the first to win 2 wins/);
  const pro = start(doubles, { preset: "doubles_pro" });
  assert.match(E.answerQuestion(pro.env.sport, doubles, pro.rules, "What happens at deuce?").answer, /the next point wins the game/);
  assert.equal(E.answerQuestion(pro.env.sport, doubles, pro.rules, "What is the weather?").kind, "unknown");
  const guide = E.rulesGuide(pro.rules);
  assert.ok(guide.some((g) => g.lines.some((l) => /match tiebreak to 10/.test(l))), "the guide follows the competition's rules");
});

section("tennis: presets and invalid rules", () => {
  assert.equal(E.resolveRules({ preset: "best_of_5" }).bestOfSets, 5);
  assert.deepEqual([E.resolveRules({ preset: "doubles_pro" }).noAd, E.resolveRules({ preset: "doubles_pro" }).finalSet], [true, "match_tiebreak"]);
  assert.throws(() => E.resolveRules({ bestOfSets: 4 }), RulesError);
  assert.throws(() => E.resolveRules({ tiebreakAt: 8 }), RulesError);
  assert.throws(() => E.resolveRules({ preset: "wimbledon" }), RulesError);
  assert.throws(() => E.resolveRules({ finalSet: "golden_set" }), RulesError);
  assert.equal(E.resolveRules({ tiebreakAt: null }).tiebreakAt, null, "advantage sets are allowed");
});
