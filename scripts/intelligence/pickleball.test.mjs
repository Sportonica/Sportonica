import assert from "node:assert/strict";
import { pickleballEngine as E, pickleballCall } from "../../src/lib/intelligence/sports/pickleball.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { makeContext, openMatch, section, cell } from "./harness.mjs";

const doubles = makeContext("pickleball", 2);
const singles = makeContext("pickleball", 1);
const rally = (m, winner, extra = {}) => m.push("RALLY_WON", { winner, ...extra });
const run = (m, winner, n) => { for (let i = 0; i < n; i++) rally(m, winner); };
const game = (m) => { const st = m.env.sport.sets[m.env.sport.sets.length - 1]; return st.games[st.games.length - 1]; };
const call = (m) => pickleballCall(m.env.sport, m.rules);

section("pickleball: doubles side-out scoring: only the server scores", () => {
  const m = openMatch(E, doubles);
  assert.deepEqual([m.rules.scoring, m.rules.pointsToWin, m.rules.winBy, m.rules.bestOfGames], ["side_out", 11, 2, 3]);
  m.push("MATCH_START");
  m.refuses("RALLY_WON", { winner: "a" }, /who serves first/, "rally before the first server");
  m.push("FIRST_SERVE", { side: "a" });
  assert.equal(call(m), "0-0-2", "the first serving side starts on its second server");
  rally(m, "b");
  assert.deepEqual([game(m).a, game(m).b], [0, 0], "the receiver wins the rally but no point");
  assert.equal(call(m), "0-0-1", "side out: Bravo serve, first server");
  rally(m, "b");
  assert.equal(call(m), "1-0-1");
  rally(m, "a");
  assert.equal(call(m), "1-0-2", "second server");
  assert.deepEqual([game(m).a, game(m).b], [0, 1]);
  rally(m, "a");
  assert.equal(call(m), "0-1-1", "side out: Alpha serve");
  rally(m, "a");
  assert.deepEqual([game(m).a, game(m).b], [1, 1]);
  assert.deepEqual(E.derivedLog(m.env.sport).map((l) => l.text), ["Side out: Bravo to serve", "Second server for Bravo", "Side out: Alpha to serve"]);
  m.assertReconstructs("side-out");
});

section("pickleball: singles side-out has one server", () => {
  const m = openMatch(E, singles, { format: "singles" });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  assert.equal(call(m), "0-0");
  rally(m, "b");
  assert.equal(m.env.sport.serving, "b", "a lost rally is an immediate side out");
  assert.deepEqual([game(m).a, game(m).b], [0, 0]);
});

section("pickleball: rally scoring: every rally scores", () => {
  const m = openMatch(E, doubles, { scoring: "rally" });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  rally(m, "b");
  assert.deepEqual([game(m).a, game(m).b, m.env.sport.serving], [0, 1, "b"]);
  rally(m, "b"); rally(m, "a");
  assert.deepEqual([game(m).a, game(m).b, m.env.sport.serving], [1, 2, "a"]);
});

section("pickleball: win by two, and a point cap", () => {
  const m = openMatch(E, singles, { format: "singles", pointsToWin: 3, bestOfGames: 1 });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  run(m, "a", 2);              // 2-0
  rally(m, "b");               // side out
  run(m, "b", 2);              // 2-2
  assert.match(m.summary().lines.join(" | "), /Win by 2/);
  rally(m, "b");               // 2-3
  assert.equal(m.env.sport.decided, null, "3-2 is not a two point lead");
  rally(m, "b");               // 2-4
  assert.equal(m.env.sport.decided, "b");
  m.refuses("RALLY_WON", { winner: "a" }, /already decided/, "rally after the match");

  const capped = openMatch(E, singles, { format: "singles", scoring: "rally", pointsToWin: 3, pointCap: 4, bestOfGames: 1 });
  capped.push("MATCH_START"); capped.push("FIRST_SERVE", { side: "a" });
  for (const w of ["a", "b", "a", "b", "a", "b"]) rally(capped, w);   // 3-3
  assert.equal(capped.env.sport.decided, null);
  rally(capped, "a");
  assert.equal(capped.env.sport.decided, "a", "at the cap a one point lead wins");
});

section("pickleball: points, games, sets and match", () => {
  const m = openMatch(E, singles, { format: "singles", scoring: "rally", pointsToWin: 2, winBy: 1, bestOfGames: 3, bestOfSets: 3 });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  run(m, "a", 2);
  assert.deepEqual(m.env.sport.sets[0].gamesWon, { a: 1, b: 0 });
  assert.equal(m.env.sport.serving, "b", "first serve alternates between games");
  m.refuses("MATCH_COMPLETE", {}, /not decided/, "completing after one game");
  run(m, "b", 2);              // games 1-1
  assert.match(m.summary().lines.join(" | "), /Deciding game/);
  run(m, "a", 2);              // set 1 to Alpha
  assert.deepEqual([m.env.sport.setsWon, m.env.sport.sets.length], [{ a: 1, b: 0 }, 2]);
  assert.equal(m.summary().view.periodLabel, "Set 2, Game 1");
  run(m, "a", 4);              // set 2 to Alpha, two games to love
  assert.equal(m.env.sport.decided, "a");
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "2-0, 0-2, 2-0, 2-0, 2-0" });
  assert.deepEqual(E.mirrorScore(m.env.sport, singles, m.rules), { scoreA: 2, scoreB: 0 });
  assert.deepEqual(m.summary().view.periods.map((p) => p.label), ["S1 G1", "S1 G2", "S1 G3", "S2 G1", "S2 G2"]);
  const t = m.stats().teams;
  assert.deepEqual([cell(t, "sides", "a", "gamesWon"), cell(t, "sides", "a", "gamesLost"), cell(t, "sides", "a", "setsWon")], [4, 1, 2]);
  assert.deepEqual([cell(t, "sides", "a", "gameWinPct"), cell(t, "sides", "a", "setWinPct"), cell(t, "sides", "b", "setWinPct")], [80, 100, 0]);
  assert.deepEqual(E.validateScore(m.env.sport, singles, m.rules), []);
  m.assertReconstructs("sets");
});

section("pickleball: serve and return statistics", () => {
  const m = openMatch(E, doubles);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a", { how: "ace", player: "a1" });            // a serves, wins: 1-0
  rally(m, "b", { how: "winner", player: "b2" });         // a serves, loses: side out
  rally(m, "a", { how: "unforced_error", player: "b1" }); // b serves (1st), loses: 2nd server
  rally(m, "a", { how: "service_fault", player: "b2" });  // b serves (2nd), loses: side out
  rally(m, "a");                                          // a serves, wins: 2-0
  const t = m.stats().teams;
  assert.deepEqual([cell(t, "sides", "a", "points"), cell(t, "sides", "b", "points")], [2, 0]);
  assert.deepEqual([cell(t, "sides", "a", "served"), cell(t, "sides", "a", "serveWon"), cell(t, "sides", "a", "servePointPct")], [3, 2, 66.7]);
  assert.deepEqual([cell(t, "sides", "a", "received"), cell(t, "sides", "a", "returnWon"), cell(t, "sides", "a", "returnPointPct")], [2, 2, 100]);
  assert.equal(cell(t, "sides", "a", "pointWinPct"), 80, "rallies won, not points: 4 of 5");
  assert.deepEqual([cell(t, "sides", "b", "serviceFaults"), cell(t, "sides", "b", "unforcedErrors"), cell(t, "sides", "b", "winners"), cell(t, "sides", "a", "aces")], [1, 1, 1, 1]);
  assert.equal(cell(t, "sides", "a", "longestStreak"), 3);
  assert.equal(cell(t, "sides", "a", "gameWinPct"), null, "no game finished yet");
  assert.equal(cell(m.stats().players, "players", "b2", "serviceFaults"), 1);
  m.refuses("RALLY_WON", { winner: "b", how: "ace" }, /Only the serving side/, "ace by the receiver");
  m.refuses("RALLY_WON", { winner: "a", how: "service_fault" }, /loses the rally for the server/, "service fault winning the rally");
  m.refuses("RALLY_WON", { winner: "a", how: "winner", player: "b1" }, /wrong side/, "winner credited to the losing side");
});

section("pickleball: rules are configurable and validated", () => {
  assert.throws(() => E.resolveRules({ bestOfGames: 2 }), RulesError);
  assert.throws(() => E.resolveRules({ scoring: "tennis" }), RulesError);
  assert.throws(() => E.resolveRules({ pointsToWin: 11, pointCap: 9 }), RulesError);
  assert.equal(E.resolveRules({ pointsToWin: 15 }).pointsToWin, 15);
  const winnerServes = openMatch(E, singles, { format: "singles", scoring: "rally", pointsToWin: 1, winBy: 1, nextGameServe: "winner" });
  winnerServes.push("MATCH_START"); winnerServes.push("FIRST_SERVE", { side: "a" });
  rally(winnerServes, "a");
  assert.equal(winnerServes.env.sport.serving, "a");
});

section("pickleball: career percentages", () => {
  const play = (winner) => {
    const m = openMatch(E, singles, { format: "singles", scoring: "rally", pointsToWin: 2, winBy: 1, bestOfGames: 1 });
    m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
    run(m, winner, 2);
    return m.stats().lines.find((l) => l.subject === "player" && l.subjectKey === "a1").raw;
  };
  const agg = aggregate(E, "player", [play("a"), play("b"), play("a"), play("a")]);
  assert.deepEqual([agg.values.matches, agg.values.wins, agg.values.winPct, agg.values.points], [4, 3, 75, 6]);
  // Alpha serve first every time: 2 of 2 in each win, 0 of 1 in the loss, so 6 of 7
  assert.equal(agg.values.servePointPct, 85.7);
  assert.equal(agg.values.returnPointPct, 0);      // received once, in the loss
});
