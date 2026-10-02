import assert from "node:assert/strict";
import { volleyballEngine as E } from "../../src/lib/intelligence/sports/volleyball.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { makeContext, openMatch, section, cell } from "./harness.mjs";

const ctx = makeContext("volleyball", 7);
// short sets so a full match fits in a test: best of 3, sets to 5, decider to 3
const SHORT = { bestOf: 3, setPoints: 5, decidingSetPoints: 3 };
const six = (k) => [1, 2, 3, 4, 5, 6].map((n) => `${k}${n}`);
const rally = (m, winner, extra = {}) => m.push("RALLY_WON", { winner, ...extra });

function fullMatch() {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: six("a") });
  m.push("LINEUP", { side: "b", players: six("b") });
  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a", { how: "ace" });                       // 1-0  a1 serving
  rally(m, "a", { how: "kill", player: "a3", shots: 7 }); // 2-0
  rally(m, "b", { how: "kill", player: "b4", shots: 12 }); // 2-1  side out, Bravo rotate: b2 to serve
  rally(m, "a", { how: "service_error" });             // 3-1  b2's error, Alpha rotate: a2 to serve
  rally(m, "a"); rally(m, "a");                        // 5-1  set Alpha
  for (let i = 0; i < 5; i++) rally(m, "b");           // set 2: Bravo serve first, 0-5
  return m;
}

section("volleyball: rally point scoring and side-out rotation", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.refuses("RALLY_WON", { winner: "a" }, /who serves first/, "rally before the first server");
  m.push("LINEUP", { side: "a", players: six("a") });
  m.push("LINEUP", { side: "b", players: six("b") });
  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a");
  assert.deepEqual(m.env.sport.rotation.a, six("a"), "the serving side does not rotate when it wins");
  assert.equal(m.env.sport.serving, "a");
  rally(m, "b");
  assert.equal(m.env.sport.serving, "b", "the receiving side wins the rally and the serve");
  assert.deepEqual(m.env.sport.rotation.b, ["b2", "b3", "b4", "b5", "b6", "b1"], "and rotates one place");
  assert.deepEqual(m.env.sport.sets[0], { a: 1, b: 1, winner: null }, "every rally scores a point");
  assert.match(m.summary().view.notes.join(" "), /Bravo 2 serving/);
});

section("volleyball: sets, alternating first serve, deciding set, match", () => {
  const m = fullMatch();
  assert.deepEqual(m.env.sport.sets.slice(0, 2), [{ a: 5, b: 1, winner: "a" }, { a: 0, b: 5, winner: "b" }]);
  assert.deepEqual(m.env.sport.setsWon, { a: 1, b: 1 });
  assert.deepEqual(m.summary().lines, ["Sets level at 1-1", "Current set: 0-0", "Deciding set to 3"]);
  assert.equal(m.summary().view.brief, "0 : 0", "during a match a card shows the current set's points");
  m.refuses("MATCH_COMPLETE", {}, /until a side has won 2 sets/, "completing at 1-1");
  m.refuses("RALLY_WON", { winner: "a" }, /serves first in the deciding set/, "deciding set needs a new toss");
  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a"); rally(m, "b"); rally(m, "a"); rally(m, "b"); rally(m, "a");
  assert.deepEqual(m.env.sport.sets[2], { a: 3, b: 2, winner: null }, "3-2 is not a two point lead");
  assert.equal(m.env.sport.decided, null);
  rally(m, "a");
  assert.deepEqual(m.env.sport.sets[2], { a: 4, b: 2, winner: "a" });
  assert.equal(m.env.sport.decided, "a");
  m.refuses("RALLY_WON", { winner: "b" }, /already decided/, "rally after the match point");
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "2-1: 5-1, 0-5, 4-2" });
  assert.deepEqual(E.mirrorScore(m.env.sport, ctx, m.rules), { scoreA: 2, scoreB: 1 });
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  m.assertReconstructs("full match");
});

section("volleyball: the second set's first serve alternates", () => {
  const m = fullMatch();
  assert.equal(m.env.sport.rallies[6].srv, "b", "Alpha served first in set 1, so Bravo serve first in set 2");
});

section("volleyball: statistics and derived efficiency", () => {
  const m = fullMatch();
  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a"); rally(m, "b"); rally(m, "a"); rally(m, "b"); rally(m, "a"); rally(m, "a");
  m.push("MATCH_COMPLETE");
  const s = m.stats();
  assert.equal(cell(s.players, "players", "a1", "aces"), 1, "the ace goes to the server in position 1");
  assert.equal(cell(s.players, "players", "b2", "serviceErrors"), 1, "the service error goes to the server after the rotation");
  assert.deepEqual([cell(s.players, "players", "a3", "kills"), cell(s.players, "players", "a3", "attacks"), cell(s.players, "players", "a3", "attackPct")], [1, 1, 100]);
  assert.equal(cell(s.players, "players", "a5", "attackPct"), null, "no attacks: no attack percentage");
  // Bravo received 9 rallies and won 3 of them; Alpha received 8 and won 3
  assert.deepEqual([cell(s.teams, "sides", "b", "received"), cell(s.teams, "sides", "b", "returnWon"), cell(s.teams, "sides", "b", "sideOutPct")], [9, 3, 33.3]);
  assert.deepEqual([cell(s.teams, "sides", "a", "received"), cell(s.teams, "sides", "a", "returnWon"), cell(s.teams, "sides", "a", "sideOutPct")], [8, 3, 37.5]);
  assert.deepEqual([cell(s.teams, "sides", "a", "points"), cell(s.teams, "sides", "a", "pointsPerSet")], [9, 3]);
  assert.equal(cell(s.teams, "sides", "b", "pointsPerSet"), 2.7);      // 8 points over 3 sets
  assert.equal(cell(s.teams, "sides", "a", "serviceEff"), 11.1);       // (1 ace - 0 errors) / 9 serves
  assert.equal(cell(s.teams, "sides", "b", "serviceEff"), -12.5);      // (0 - 1) / 8 serves
  assert.equal(cell(s.teams, "sides", "a", "longestRally"), 12);
  assert.equal(cell(s.teams, "sides", "a", "receptionEff"), null, "no receptions were recorded");
  assert.equal(cell(s.teams, "sides", "b", "longestStreak"), 5);
  const sets = m.analytics().charts.find((c) => c.key === "sets");
  assert.deepEqual(sets.series.map((x) => x.values), [[5, 0, 4], [1, 5, 2]]);
  const runs = m.analytics().tables.find((t) => t.key === "runs");
  assert.deepEqual(runs.rows.map((r) => [r.name, r.values.set, r.values.length]), [["Bravo", 2, 5]]);
});

section("volleyball: touches feed attack, dig, assist and reception figures", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  m.push("TOUCH", { side: "b", player: "b1", kind: "reception", quality: "perfect" });
  m.push("TOUCH", { side: "b", player: "b1", kind: "reception", quality: "error" });
  m.push("TOUCH", { side: "b", player: "b1", kind: "reception", quality: "poor" });
  m.push("TOUCH", { side: "b", player: "b1", kind: "reception", quality: "good" });
  m.push("TOUCH", { side: "b", player: "b2", kind: "assist" });
  m.push("TOUCH", { side: "b", player: "b3", kind: "attack" });
  m.push("TOUCH", { side: "a", player: "a1", kind: "dig" });
  rally(m, "b", { how: "kill", player: "b3" });
  rally(m, "a", { how: "attack_error", player: "b3" });
  rally(m, "a", { how: "block", player: "a2" });
  const p = m.stats().players;
  assert.deepEqual([cell(p, "players", "b1", "receptions"), cell(p, "players", "b1", "receptionEff")], [4, 25]);   // (2 positive - 1 error) / 4
  assert.deepEqual([cell(p, "players", "b3", "attacks"), cell(p, "players", "b3", "kills"), cell(p, "players", "b3", "attackErrors")], [3, 1, 1]);
  assert.equal(cell(p, "players", "b3", "attackPct"), 0);              // (1 - 1) / 3
  assert.equal(cell(p, "players", "b3", "killPct"), 33.3);
  assert.equal(cell(p, "players", "a2", "blocks"), 1);
  assert.equal(cell(p, "players", "a1", "digs"), 1);
  assert.equal(cell(p, "players", "b2", "assists"), 1);
});

section("volleyball: impossible events are refused", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  m.refuses("RALLY_WON", { winner: "b", how: "ace" }, /Only the serving side/, "ace by the receiver");
  m.refuses("RALLY_WON", { winner: "a", how: "service_error" }, /gives the point to the receiving side/, "service error winning the point");
  m.refuses("RALLY_WON", { winner: "a", how: "kill", player: "b1" }, /belongs to the side that won/, "kill by the losing side");
  m.refuses("RALLY_WON", { winner: "a", how: "attack_error", player: "a1" }, /belongs to the side that lost/, "attack error by the winning side");
  m.refuses("RALLY_WON", { winner: "a", how: "spike" }, /Unknown way/, "unknown outcome");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2", "a3"] }, /exactly 6/, "short lineup");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5", "b1"] }, /belong to that side/, "opponent in the lineup");
  m.push("TIMEOUT", { side: "a" }); m.push("TIMEOUT", { side: "a" });
  m.refuses("TIMEOUT", { side: "a" }, /no timeouts left/, "third timeout in a set");
  m.push("LINEUP", { side: "a", players: six("a") });
  m.refuses("SUBSTITUTION", { side: "a", in: "a2", out: "a1" }, /already on court/, "substituting in a player on court");
  m.push("SUBSTITUTION", { side: "a", in: "a7", out: "a1" });
  assert.equal(m.env.sport.rotation.a[0], "a7", "the substitute takes the same rotation position");
  assert.throws(() => E.resolveRules({ bestOf: 4 }), RulesError);
});

section("volleyball: formats are configurable (best of 5 to 25, capped sets)", () => {
  const d = E.resolveRules({});
  assert.deepEqual([d.bestOf, d.setPoints, d.decidingSetPoints, d.winBy, d.pointCap], [5, 25, 15, 2, null]);
  const m = openMatch(E, ctx, { bestOf: 1, setPoints: 3, pointCap: 4 });
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a"); rally(m, "a"); rally(m, "b"); rally(m, "b"); rally(m, "b"); rally(m, "a"); // 3-3
  assert.equal(m.env.sport.decided, null);
  rally(m, "a");
  assert.equal(m.env.sport.decided, "a", "at the cap a one point lead wins");
});

section("volleyball: historical aggregation", () => {
  const a = fullMatch(), b = fullMatch();
  const line = (m) => m.stats().lines.find((l) => l.subject === "player" && l.subjectKey === "a3").raw;
  const agg = aggregate(E, "player", [line(a), line(b)]);
  assert.deepEqual([agg.values.kills, agg.values.killsPerMatch, agg.values.attackPct], [2, 1, 100]);
});
