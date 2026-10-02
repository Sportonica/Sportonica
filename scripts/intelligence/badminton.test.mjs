import assert from "node:assert/strict";
import { badmintonEngine as E } from "../../src/lib/intelligence/sports/badminton.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { makeContext, openMatch, section, cell, card } from "./harness.mjs";

const singles = makeContext("badminton", 1);
const doubles = makeContext("badminton", 2);
const rally = (m, winner, extra = {}) => m.push("RALLY_WON", { winner, ...extra });
const run = (m, winner, n) => { for (let i = 0; i < n; i++) rally(m, winner); };
const game = (m) => m.env.sport.games[m.env.sport.games.length - 1];

section("badminton: rally point, the winner serves", () => {
  const m = openMatch(E, singles);
  m.push("MATCH_START");
  m.refuses("RALLY_WON", { winner: "a" }, /who serves first/, "rally before the first server");
  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "b");
  assert.deepEqual([game(m).a, game(m).b, m.env.sport.serving], [0, 1, "b"], "the receiver scores and takes the serve");
  rally(m, "b");
  assert.deepEqual([game(m).b, m.env.sport.serving], [2, "b"]);
});

section("badminton: deuce, extended game and the 30 point cap", () => {
  const m = openMatch(E, singles);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  run(m, "a", 20); run(m, "b", 20);
  assert.deepEqual([game(m).a, game(m).b], [20, 20]);
  assert.match(m.summary().lines.join(" | "), /Extended game: a 2 point lead is needed/);
  rally(m, "a");
  assert.equal(game(m).winner, null, "21-20 does not win the game");
  rally(m, "b");
  for (let i = 0; i < 8; i++) { rally(m, "a"); rally(m, "b"); }    // 29-29
  assert.deepEqual([game(m).a, game(m).b, game(m).winner], [29, 29, null]);
  assert.match(m.summary().lines.join(" | "), /Next point wins the game/);
  rally(m, "a");
  assert.deepEqual(m.env.sport.games[0], { a: 30, b: 29, winner: "a" }, "at 29 all the 30th point wins");
  assert.equal(m.env.sport.games.length, 2);
  assert.equal(m.env.sport.serving, "a", "the winner of a game serves first in the next");
});

section("badminton: games and match (best of three)", () => {
  const m = openMatch(E, singles);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  run(m, "a", 21);
  assert.deepEqual(m.env.sport.gamesWon, { a: 1, b: 0 });
  m.refuses("MATCH_COMPLETE", {}, /needs 2 games/, "completing after one game");
  m.refuses("FIRST_SERVE", { side: "b" }, /winner of the previous game serves first/, "re-tossing for game 2");
  run(m, "b", 21);
  run(m, "a", 20); run(m, "b", 20); run(m, "a", 2);
  assert.deepEqual(m.env.sport.games, [{ a: 21, b: 0, winner: "a" }, { a: 0, b: 21, winner: "b" }, { a: 22, b: 20, winner: "a" }]);
  assert.equal(m.env.sport.decided, "a");
  m.refuses("RALLY_WON", { winner: "b" }, /already decided/, "rally after match point");
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "2-1: 21-0, 0-21, 22-20" });
  assert.deepEqual(E.mirrorScore(m.env.sport, singles, m.rules), { scoreA: 2, scoreB: 1 });
  assert.deepEqual(E.validateScore(m.env.sport, singles, m.rules), []);
  assert.deepEqual(m.summary().view.periods, [{ label: "G1", a: "21", b: "0" }, { label: "G2", a: "0", b: "21" }, { label: "G3", a: "22", b: "20" }]);
  assert.equal(m.summary().view.brief, "21-0, 0-21, 22-20", "a finished match shows its game scores on a card");
  m.assertReconstructs("three games");
});

section("badminton: doubles service courts, server and receiver", () => {
  const m = openMatch(E, doubles, { format: "doubles" });
  m.push("MATCH_START");
  m.push("FIRST_SERVE", { side: "a", server: "a1", receiver: "b1" });
  const who = () => [m.env.sport.server, m.env.sport.receiver];
  assert.deepEqual(who(), ["a1", "b1"], "0-0: a1 serves from the right court to b1");
  rally(m, "a");   // 1-0: the serving side swaps courts, the same player serves from the left
  assert.deepEqual(who(), ["a1", "b2"]);
  assert.deepEqual(m.env.sport.courts.a, { right: "a2", left: "a1" });
  rally(m, "b");   // 1-1: Bravo serve; their score is odd so the left court player serves; nobody swaps
  assert.deepEqual(who(), ["b2", "a1"]);
  assert.deepEqual(m.env.sport.courts.b, { right: "b1", left: "b2" });
  rally(m, "a");   // 2-1: Alpha serve; even score, right court player
  assert.deepEqual(who(), ["a2", "b1"]);
  rally(m, "a");   // 3-1: swap, a2 now serves from the left
  assert.deepEqual(who(), ["a2", "b2"]);
  assert.match(m.summary().view.notes[0], /Alpha 2 to serve from the left court to Bravo 2/);
  m.refuses("RALLY_WON", { winner: "a", how: "smash_winner", player: "b1" }, /side that won the rally/, "winner credited to the losing pair");
});

section("badminton: statistics and derived percentages", () => {
  const m = openMatch(E, singles, { pointsToWin: 3, bestOf: 1 });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a", { how: "ace" });                       // a serving
  rally(m, "b", { how: "smash_winner", shots: 10 });   // a serving
  rally(m, "b", { how: "unforced_error", player: "a1", shots: 20 }); // b serving
  rally(m, "a", { how: "service_error" });             // b serving, b's error
  rally(m, "a", { how: "net_winner" });                // a serving, 3-2: not yet two clear
  assert.equal(m.env.sport.decided, null);
  rally(m, "a", { how: "defensive" });                 // 4-2
  assert.equal(m.env.sport.decided, "a");
  const t = m.stats().teams;
  assert.deepEqual([cell(t, "sides", "a", "points"), cell(t, "sides", "a", "pointsAgainst")], [4, 2]);
  assert.equal(cell(t, "sides", "a", "pointWinPct"), 66.7);
  assert.equal(cell(t, "sides", "a", "servePointPct"), 75);      // served 4, won 3
  assert.equal(cell(t, "sides", "a", "returnPointPct"), 50);     // received 2, won 1
  assert.equal(cell(t, "sides", "b", "servePointPct"), 50);
  assert.equal(cell(t, "sides", "b", "returnPointPct"), 25);
  assert.deepEqual([cell(t, "sides", "a", "aces"), cell(t, "sides", "a", "netWinners"), cell(t, "sides", "a", "defensivePoints"), cell(t, "sides", "a", "unforcedErrors")], [1, 1, 1, 1]);
  assert.deepEqual([cell(t, "sides", "b", "smashWinners"), cell(t, "sides", "b", "serviceErrors"), cell(t, "sides", "b", "serves")], [1, 1, 2]);
  assert.equal(cell(t, "sides", "a", "avgRally"), 15, "only the two rallies with a recorded length count");
  assert.equal(cell(t, "sides", "a", "longestRally"), 20);
  assert.equal(cell(t, "sides", "a", "longestStreak"), 3);
  assert.equal(cell(t, "sides", "a", "gameWinPct"), 100);
  const p = m.stats().players;
  assert.deepEqual([cell(p, "players", "a1", "aces"), cell(p, "players", "a1", "serves"), cell(p, "players", "b1", "serviceErrors")], [1, 4, 1]);
  assert.equal(card(m.analytics(), "Current run"), "Alpha 3");
  m.refuses("RALLY_WON", { winner: "a" }, /already decided/, "after the match");
});

section("badminton: rally length and impossible outcomes", () => {
  const m = openMatch(E, singles);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a");
  assert.equal(cell(m.stats().teams, "sides", "a", "avgRally"), null, "no rally length recorded: average is unknown, not 0");
  assert.equal(cell(m.stats().teams, "sides", "a", "longestRally"), null);
  m.refuses("RALLY_WON", { winner: "b", how: "ace" }, /Only the serving side/, "ace by the receiver");
  m.refuses("RALLY_WON", { winner: "a", how: "service_error" }, /gives the point to the receiver/, "service error winning the point");
  m.refuses("RALLY_WON", { winner: "a", shots: 0 }, /positive whole number/, "zero length rally");
  m.refuses("RALLY_WON", { winner: "c" }, /which side won/, "unknown side");
});

section("badminton: a corrected rally changes who was serving afterwards", () => {
  const m = openMatch(E, singles, { pointsToWin: 5, bestOf: 1 });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  const wrong = rally(m, "a"); rally(m, "a"); rally(m, "b");
  m.correct("replace", wrong.id, "Shuttle landed out", "RALLY_WON", { winner: "b" });
  assert.deepEqual([game(m).a, game(m).b], [1, 2]);
  assert.deepEqual(m.env.sport.rallies.map((r) => `${r.srv}>${r.w}`), ["a>b", "b>a", "a>b"], "serve order is rebuilt from the corrected rally onwards");
});

section("badminton: career win percentage and rally figures", () => {
  const play = (winner) => {
    const m = openMatch(E, singles, { pointsToWin: 2, winBy: 1, bestOf: 1, pointCap: null });
    m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
    rally(m, winner, { shots: 4 }); rally(m, winner, { shots: 8 });
    return m.stats().lines.find((l) => l.subject === "player" && l.subjectKey === "a1").raw;
  };
  const agg = aggregate(E, "player", [play("a"), play("a"), play("b")]);
  assert.deepEqual([agg.values.matches, agg.values.wins, agg.values.winPct], [3, 2, 66.7]);
  assert.equal(agg.values.pointWinPct, 66.7);
  assert.equal(agg.values.avgRally, 6);
  assert.equal(agg.values.longestRally, 8, "the longest rally is a maximum, not a sum");
  assert.equal(agg.values.gamesWon, 2);
});
