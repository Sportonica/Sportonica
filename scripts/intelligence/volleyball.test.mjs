import assert from "node:assert/strict";
import { volleyballEngine as E } from "../../src/lib/intelligence/sports/volleyball.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { reconstruct } from "../../src/lib/intelligence/core/engine.ts";
import { checkSetScores, VOLLEYBALL_PRESETS, attackEfficiency, mvpRating, pointsScored } from "../../src/lib/intelligence/sports/volleyballRules.ts";
import { computeVolleyballStandings, ratioText } from "../../src/lib/tournaments/standings.ts";
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

// ── formats, rotation, Libero, sanctions, entered results ──────────


const full = (rulesInput = {}, players = 8) => {
  const c = makeContext("volleyball", players);
  const m = openMatch(E, c, { bestOf: 3, setPoints: 5, decidingSetPoints: 3, ...rulesInput });
  m.push("MATCH_START");
  return m;
};
const started = (rulesInput = {}) => {
  const m = full(rulesInput);
  m.push("LINEUP", { side: "a", players: six("a") });
  m.push("LINEUP", { side: "b", players: six("b") });
  m.push("FIRST_SERVE", { side: "a" });
  return m;
};

section("volleyball formats: indoor, best of 3, beach and their deuce", () => {
  const indoor = E.resolveRules({});
  assert.deepEqual([indoor.bestOf, indoor.setPoints, indoor.decidingSetPoints, indoor.winBy, indoor.pointCap], [5, 25, 15, 2, null]);
  const beach = E.resolveRules({ preset: "beach" });
  assert.deepEqual([beach.bestOf, beach.setPoints, beach.decidingSetPoints, beach.playersOnCourt, beach.substitutionsPerSet, beach.liberoAllowed], [3, 21, 15, 2, 0, false]);
  assert.equal(E.resolveRules({ preset: "indoor3" }).bestOf, 3);
  assert.throws(() => E.resolveRules({ bestOf: 4 }), RulesError, "an even number of sets could end level");
  assert.throws(() => E.resolveRules({ tiebreakers: ["coin_toss"] }), RulesError);

  const m = openMatch(E, makeContext("volleyball", 7), {});
  m.push("MATCH_START"); m.push("FIRST_SERVE", { side: "a" });
  for (let i = 0; i < 24; i++) { rally(m, "a"); rally(m, "b"); }
  assert.deepEqual(m.env.sport.sets[0], { a: 24, b: 24, winner: null }, "24-24 plays on");
  rally(m, "a"); assert.equal(m.env.sport.sets[0].winner, null, "25-24 is not two clear");
  rally(m, "b"); rally(m, "a"); rally(m, "b"); rally(m, "a"); rally(m, "a");
  assert.deepEqual(m.env.sport.sets[0], { a: 28, b: 26, winner: "a" }, "extended deuce has no cap");
  m.assertReconstructs("deuce");
});

section("volleyball rotation: only on winning the serve, and each set starts from the confirmed order", () => {
  const m = started();
  rally(m, "a"); rally(m, "a");
  assert.deepEqual(m.env.sport.rotation.a, six("a"), "no rotation while the serving side keeps scoring");
  rally(m, "b");
  assert.deepEqual(m.env.sport.rotation.b, ["b2", "b3", "b4", "b5", "b6", "b1"]);
  assert.deepEqual(m.env.sport.rotation.a, six("a"), "the side losing the serve does not rotate");
  rally(m, "a");
  assert.deepEqual(m.env.sport.rotation.a, ["a2", "a3", "a4", "a5", "a6", "a1"]);
  assert.match(m.summary().view.notes.join(" "), /Alpha 2 serving/);
  rally(m, "a"); rally(m, "a");
  assert.deepEqual(m.env.sport.sets[0], { a: 5, b: 1, winner: "a" });
  assert.deepEqual(m.env.sport.rotation.a, six("a"), "the new set returns to the starting order");
  assert.equal(m.env.sport.serving, "b", "and the other side serves first");
  assert.ok(m.env.sport.rotationLog.length >= 4, "every change of order is on the rotation history");
  m.assertReconstructs("rotation");
});

section("volleyball substitutions: limits, pairs, and who can come on", () => {
  const m = started({ substitutionsPerSet: 3 });
  m.refuses("SUBSTITUTION", { side: "a", in: "a1", out: "a2" }, /already on court/, "both on court");
  m.refuses("SUBSTITUTION", { side: "a", in: "a7", out: "a8" }, /not on court/, "off-court player going off");
  m.push("SUBSTITUTION", { side: "a", in: "a7", out: "a1" });
  assert.equal(m.env.sport.rotation.a[0], "a7");
  m.refuses("SUBSTITUTION", { side: "a", in: "a8", out: "a7" }, /only swap with/, "a sub can only go back for the player they replaced");
  m.push("SUBSTITUTION", { side: "a", in: "a1", out: "a7" });
  m.refuses("SUBSTITUTION", { side: "a", in: "a7", out: "a1" }, /already gone off/, "there and back once a set");
  m.push("SUBSTITUTION", { side: "a", in: "a8", out: "a2" });
  assert.equal(m.env.sport.subs.a, 3);
  m.refuses("SUBSTITUTION", { side: "a", in: "b1", out: "a3" }, /used all 3/, "the team limit comes first");
  m.assertReconstructs("substitutions");
});

section("volleyball Libero: back row only, never serves, leaves at the front row, no substitution used", () => {
  const m = full();
  m.push("LIBERO_SET", { side: "b", players: ["b7"] });
  m.refuses("LINEUP", { side: "b", players: ["b7", "b2", "b3", "b4", "b5", "b6"] }, /Libero can't be in the starting order/, "Libero as a starter");
  m.push("LINEUP", { side: "a", players: six("a") });
  m.push("LINEUP", { side: "b", players: six("b") });
  m.push("FIRST_SERVE", { side: "a" });
  m.refuses("LIBERO_IN", { side: "b", libero: "b8", for: "b5" }, /isn't this team's Libero/, "unnamed Libero");
  m.refuses("LIBERO_IN", { side: "b", libero: "b7", for: "b2" }, /only replace a back-row/, "front row");
  m.push("LIBERO_IN", { side: "b", libero: "b7", for: "b5" }); // position 5
  assert.equal(m.env.sport.subs.b, 0, "a Libero replacement is not a substitution");
  assert.deepEqual(m.env.sport.liberoOn.b, { libero: "b7", player: "b5" });
  m.refuses("SUBSTITUTION", { side: "b", in: "b8", out: "b7" }, /Libero/, "a Libero is not substituted");
  rally(m, "b"); // Bravo win the serve and rotate: position 5 moves to the front row
  assert.equal(m.env.sport.liberoOn.b, null, "the Libero comes off as they reach the front row");
  assert.equal(m.env.sport.rotation.b[3], "b5", "and the player they replaced is back in that spot");
  assert.ok(!m.env.sport.rotation.b.includes("b7"));
  rally(m, "a"); rally(m, "b"); // Bravo serving again
  const server = m.env.sport.rotation.b[0];
  m.refuses("LIBERO_IN", { side: "b", libero: "b7", for: server }, /can't serve/, "the Libero can't replace the server");
  m.assertReconstructs("libero");
  const beach = openMatch(E, makeContext("volleyball", 3), { preset: "beach" });
  beach.push("MATCH_START");
  beach.refuses("LIBERO_SET", { side: "a", players: ["a3"] }, /no Libero/, "no Libero on the beach");
});

section("volleyball beach: two players alternate serves with no six-player rotation", () => {
  const m = openMatch(E, makeContext("volleyball", 2), { preset: "beach" });
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: ["a1", "a2"] });
  m.push("LINEUP", { side: "b", players: ["b1", "b2"] });
  m.refuses("SUBSTITUTION", { side: "a", in: "a2", out: "a1" }, /used all 0/, "no substitutes");
  m.push("FIRST_SERVE", { side: "a" });
  assert.equal(m.env.sport.rotation.a[0], "a1");
  rally(m, "b"); rally(m, "a");
  assert.equal(m.env.sport.rotation.a[0], "a2", "the partner serves when the side wins the serve back");
});

section("volleyball sanctions and faults", () => {
  const m = started();
  m.push("SANCTION", { side: "a", card: "yellow", player: "a2" });
  assert.deepEqual(m.env.sport.sets[0], { a: 0, b: 0, winner: null }, "a yellow card scores nothing");
  m.push("SANCTION", { side: "a", card: "red", player: "a2" });
  assert.deepEqual(m.env.sport.sets[0], { a: 0, b: 1, winner: null }, "a red card gives the other team a point");
  assert.equal(m.env.sport.serving, "b", "and the serve");
  m.push("SANCTION", { side: "a", card: "expulsion", player: "a3" });
  m.refuses("SUBSTITUTION", { side: "a", in: "a3", out: "a4" }, /already on court|sent off/, "an expelled player can't come back");
  m.push("SUBSTITUTION", { side: "a", in: "a7", out: "a3" });
  m.refuses("SANCTION", { side: "a", card: "expulsion" }, /which player/, "a team can't be expelled");
  m.refuses("RALLY_WON", { winner: "a", how: "reception_error" }, /serving side/, "a reception error goes to the server's side");
  m.refuses("RALLY_WON", { winner: "b", how: "foot_fault" }, /receiving side/, "a foot fault goes to the receiver");
  m.push("RALLY_WON", { winner: "b", how: "net_fault", player: "a4" });
  m.push("RALLY_WON", { winner: "a", how: "rotation_fault" });
  const s = m.stats();
  assert.equal(cell(s.players, "players", "a2", "yellowCards"), 1);
  assert.equal(cell(s.players, "players", "a2", "redCards"), 1);
  m.assertReconstructs("sanctions");
});

section("volleyball statistics: from recorded events only, using the stated formulas", () => {
  const raw = { attacks: 10, kills: 6, attackErrors: 2, blocks: 3, aces: 1, assists: 4, digs: 2, receptionPositive: 2, serviceErrors: 1, receptionErrors: 1 };
  assert.equal(attackEfficiency(raw), 40, "(6 - 2) / 10");
  assert.equal(attackEfficiency({ kills: 3 }), null, "no attempts, no efficiency");
  assert.equal(pointsScored(raw), 10);
  assert.equal(mvpRating(raw), 10 + (8 - 4) / 2);

  const m = started();
  rally(m, "a", { how: "kill", player: "a3" });
  rally(m, "a", { how: "block", player: "a4" });
  rally(m, "b", { how: "attack_error", player: "a3" });
  rally(m, "a", { how: "block_error", player: "b2" });
  rally(m, "b", { how: "setting_error", player: "a2" });
  const s = m.stats();
  assert.equal(cell(s.players, "players", "a3", "attackPct"), 0, "one kill, one error, two attacks");
  assert.equal(cell(s.players, "players", "a3", "pointsScored"), 1);
  assert.equal(cell(s.players, "players", "a4", "blocks"), 1);
  assert.equal(cell(s.players, "players", "b2", "blockErrors"), 1);
  assert.equal(cell(s.players, "players", "a2", "settingErrors"), 1);
  const lines = m.stats().lines.filter((l) => l.subject === "player");
  assert.ok(!lines.some((l) => l.subjectKey === "a8"), "a bench player who never played has no line");
});

section("set score validation: what the result form and the server accept", () => {
  const five = VOLLEYBALL_PRESETS.indoor, three = VOLLEYBALL_PRESETS.indoor3;
  const ok = (sets, rules, won) => { const c = checkSetScores(sets, rules); assert.deepEqual(c.errors, []); assert.equal(c.winner, won); };
  const bad = (sets, rules, pattern) => assert.match(checkSetScores(sets, rules).errors.join(" "), pattern);
  ok([{ a: 25, b: 21 }, { a: 22, b: 25 }, { a: 25, b: 19 }, { a: 18, b: 25 }, { a: 15, b: 12 }], five, "a");
  ok([{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], five, "a");
  ok([{ a: 21, b: 25 }, { a: 25, b: 23 }, { a: 13, b: 15 }], three, "b");
  ok([{ a: 26, b: 24 }, { a: 31, b: 29 }, { a: 40, b: 38 }], five, "a");
  ok([{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 17, b: 15 }], three, "a");
  bad([{ a: 24, b: 20 }], five, /not finished. A team must reach 25/);
  bad([{ a: 25, b: 24 }], five, /must win by 2/);
  bad([{ a: 30, b: 20 }, { a: 25, b: 20 }, { a: 25, b: 20 }], five, /impossible. The set ends at 25-20/);
  bad([{ a: -1, b: 25 }], five, /whole numbers/);
  bad([{ a: NaN, b: 25 }], five, /whole numbers/);
  bad([{ a: 25, b: 20 }, { a: 25, b: 20 }], five, /must win 3 sets/);
  bad([{ a: 25, b: 20 }, { a: 25, b: 20 }, { a: 25, b: 20 }, { a: 25, b: 20 }], five, /already decided in set 3/);
  bad([{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 20 }, { a: 25, b: 20 }], three, /already decided in set 3|best of 3/);
  bad([{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 15, b: 10 }, { a: 25, b: 20 }, { a: 15, b: 10 }], five, /Set 3/);
  bad([{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 10 }], five, /impossible. The set ends at 15-10/);
  bad([], five, /Enter the set scores/);
});

const RESULT = { sets: [{ a: 25, b: 21 }, { a: 22, b: 25 }, { a: 25, b: 19 }, { a: 18, b: 25 }, { a: 15, b: 12 }] };

section("quick result entry: final sets finish the match without inventing anything", () => {
  const c = makeContext("volleyball", 7);
  const m = openMatch(E, c, {});
  m.push("MATCH_START");
  m.refuses("FINAL_SETS", { sets: [{ a: 25, b: 24 }] }, /must win by 2/, "invalid score");
  m.refuses("FINAL_SETS", { sets: RESULT.sets, lines: [{ player: "zz", kills: 1 }] }, /not in this match/, "unknown player");
  m.refuses("FINAL_SETS", { sets: RESULT.sets, lines: [{ player: "a1", attacks: 1, kills: 4 }] }, /can't be more than attacks/, "impossible figures");
  const saved = m.push("FINAL_SETS", RESULT);
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.status, "completed");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "3-2: 25-21, 22-25, 25-19, 18-25, 15-12" });
  assert.deepEqual(E.mirrorScore(m.env.sport, c, m.rules), { scoreA: 3, scoreB: 2 });
  assert.deepEqual(E.validateScore(m.env.sport, c, m.rules), []);
  const lines = m.stats().lines;
  assert.equal(lines.filter((l) => l.subject === "player").length, 0, "no player gets figures from a final score");
  const team = lines.find((l) => l.subject === "team" && l.side === "a");
  assert.deepEqual([team.raw.points, team.raw.pointsAgainst, team.raw.setsWon, team.raw.setsLost], [105, 102, 3, 2], "team points come from the sets");
  m.assertReconstructs("quick result");

  // correcting it replaces the event and keeps the old one
  m.correct("replace", saved.id, "Wrong set 5 on the sheet", "FINAL_SETS", { sets: [{ a: 25, b: 21 }, { a: 22, b: 25 }, { a: 25, b: 19 }, { a: 18, b: 25 }, { a: 12, b: 15 }] });
  assert.equal(m.env.status, "completed", "a correction keeps it complete");
  assert.equal(m.env.result.winner, "b", "and the result follows the corrected sets");
  assert.ok(m.events.some((e) => e.id === saved.id), "the old entry is kept");
  assert.equal(m.events[m.events.length - 1].reason, "Wrong set 5 on the sheet");
});

section("detailed result: only what was typed", () => {
  const c = makeContext("volleyball", 7);
  const m = openMatch(E, c, {});
  m.push("MATCH_START");
  m.push("FINAL_SETS", { ...RESULT, mvp: "a3", notes: "Rain delay", lines: [{ player: "a3", attacks: 20, kills: 12, attackErrors: 2, aces: 1, yellowCards: 1 }] });
  m.push("MATCH_COMPLETE");
  const s = m.stats();
  assert.equal(cell(s.players, "players", "a3", "attackPct"), 50);
  assert.equal(cell(s.players, "players", "a3", "yellowCards"), 1);
  assert.equal(m.env.sport.mvp, "a3");
  assert.equal(m.env.sport.notes, "Rain delay");
  const lines = s.lines.filter((l) => l.subject === "player");
  assert.deepEqual(lines.map((l) => l.subjectKey), ["a3"], "only that player has a line");
  assert.equal(lines[0].raw.matchMvps, 1);
  assert.match(m.summary().view.notes.join(" "), /MVP: Alpha 3/);
});

section("live scoring to an entered result: confirmed, and the history stays", () => {
  const m = started({ bestOf: 5, setPoints: 25, decidingSetPoints: 15 });
  rally(m, "a"); rally(m, "b");
  m.refuses("FINAL_SETS", RESULT, /scored live/, "not without confirming");
  m.push("FINAL_SETS", { ...RESULT, overrideLive: true });
  assert.equal(m.env.sport.decided, "a");
  assert.equal(m.env.sport.rallies.length, 2, "the live rallies are still on record");
  m.refuses("RALLY_WON", { winner: "a" }, /entered by hand/, "no more points after an entered result");
  m.refuses("FINAL_SETS", RESULT, /already entered/, "no second entry");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.winner, "a");
  m.assertReconstructs("live to entered");
});

section("undo: reversing a point restores serve and rotation exactly", () => {
  const m = started();
  rally(m, "a");
  const before = JSON.stringify(m.env.sport);
  const ev = rally(m, "b");
  assert.equal(m.env.sport.serving, "b");
  m.correct("void", ev.id, "Undone by the scorer");
  const { rallies: _r1, ...now } = m.env.sport, { rallies: _r2, ...then } = JSON.parse(before);
  assert.deepEqual(JSON.parse(JSON.stringify(now)), then);
  assert.equal(m.env.sport.rallies.length, 1);
});

section("volleyball league table: set and point ratios, deciding-set points, tiebreaks", () => {
  const team = (id) => ({ id, name: id.toUpperCase(), status: "confirmed", group_name: null });
  const teams = [team("x"), team("y"), team("z")];
  const fx = (id, a, b, sa, sb, status = "completed") => ({
    id, team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, status, stage: "league", group_name: null, round: 1, starts_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", winner_team_id: sa === null ? a : sa > sb ? a : b,
  });
  const matches = [fx("m1", "x", "y", 3, 2), fx("m2", "y", "z", 3, 0), fx("m3", "z", "x", 3, 1), fx("m4", "x", "z", null, null, "walkover")];
  const facts = {
    m1: { sets: [{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 20 }, { a: 20, b: 25 }, { a: 15, b: 10 }] },
    m2: { sets: [{ a: 25, b: 10 }, { a: 25, b: 10 }, { a: 25, b: 10 }] },
    m3: { sets: [{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 20 }, { a: 25, b: 20 }] },
  };
  const rows = computeVolleyballStandings(matches, teams, {}, null, facts);
  const by = Object.fromEntries(rows.map((r) => [r.team_id, r]));
  assert.deepEqual([by.y.played, by.y.won, by.y.lost, by.y.points], [2, 1, 1, 4], "3-0 is worth 3, a 2-3 loss 1");
  assert.deepEqual([by.x.played, by.x.won, by.x.lost, by.x.points], [3, 2, 1, 5], "a 3-2 win is 2, a walkover win 3, a 1-3 loss 0");
  assert.deepEqual([by.z.won, by.z.lost, by.z.forfeits, by.z.points], [1, 2, 1, 3]);
  assert.equal(by.x.goals_for, 4, "a walkover adds no sets");
  assert.equal(by.y.set_ratio, 1.667, "5 sets won, 3 lost");
  assert.equal(by.y.points_for, 100 + 75, "points for add up across the sets");
  assert.deepEqual(rows.map((r) => r.team_id), ["x", "y", "z"]);
  assert.equal(ratioText(null, 3), "MAX");
  assert.equal(ratioText(null, 0), "–");
  assert.equal(ratioText(1.5, 3), "1.500");

  // level on points: the competition's tiebreak order decides
  // x and y both on 3 points: x's 3-1 has the better set ratio, y's wider points the better point ratio
  const pair = [fx("p1", "x", "z", 3, 1), fx("p2", "y", "z", 3, 0), fx("p3", "z", "x", 3, 0), fx("p4", "z", "y", 3, 1)];
  const pf = { p1: { sets: [{ a: 25, b: 23 }, { a: 25, b: 23 }, { a: 23, b: 25 }, { a: 25, b: 23 }] }, p2: { sets: [{ a: 25, b: 23 }, { a: 25, b: 23 }, { a: 25, b: 23 }] }, p3: { sets: [{ a: 25, b: 10 }, { a: 25, b: 10 }, { a: 25, b: 10 }] }, p4: { sets: [{ a: 25, b: 23 }, { a: 25, b: 23 }, { a: 23, b: 25 }, { a: 25, b: 23 }] } };
  const order = (tiebreakers) => computeVolleyballStandings(pair, teams, { tiebreakers }, null, pf).map((r) => r.team_id).filter((id) => id !== "z");
  assert.deepEqual(order(["point_ratio"]), ["y", "x"], "y has the better point ratio");
  assert.deepEqual(order([]), ["x", "y"], "no tiebreak left: by name");
  // head to head when the competition says so
  const hh = [fx("h1", "x", "y", 3, 0), fx("h2", "y", "z", 3, 0), fx("h3", "x", "z", 0, 3)];
  const three = computeVolleyballStandings(hh, teams, { tiebreakers: ["head_to_head"] }, null, {});
  assert.equal(new Set(three.map((r) => r.points)).size, 1, "all level on 3");
  assert.deepEqual(three.map((r) => r.team_id), ["x", "y", "z"], "each won one against the others, so by name");
  // fixtures added by hand name the group on the match; the teams have none
  const grouped = [{ ...fx("g1", "x", "y", 3, 0), stage: "group", group_name: "A" }];
  const groupA = computeVolleyballStandings(grouped, teams, {}, "A", {});
  assert.deepEqual(groupA.map((r) => [r.team_id, r.played, r.points]), [["x", 1, 3], ["y", 1, 0]], "only the teams playing in the group");
});

section("volleyball: points added to a player never touch the team score", () => {
  const m = openMatch(E, ctx, SHORT);
  m.refuses("PLAYER_POINTS", { player: "a1", points: 3 }, /Start the match/, "before the match");
  m.push("MATCH_START");
  m.refuses("PLAYER_POINTS", { player: "a1", points: 0 }, /whole number/, "zero points");
  m.refuses("PLAYER_POINTS", { player: "a1", points: -2 }, /whole number/, "negative points");
  m.refuses("PLAYER_POINTS", { player: "a1", points: 1.5 }, /whole number/, "part of a point");
  m.refuses("PLAYER_POINTS", { player: "a1", points: "3" }, /whole number/, "not a number");
  m.refuses("PLAYER_POINTS", { player: "nobody", points: 3 }, /not in this match/, "someone else");

  m.push("FIRST_SERVE", { side: "a" });
  rally(m, "a");
  const score = () => JSON.stringify([m.env.sport.sets, m.env.sport.setsWon, m.env.sport.serving, m.env.sport.rallies, m.env.sport.team]);
  const before = score();
  m.push("PLAYER_POINTS", { player: "a1", points: 3 });
  m.push("PLAYER_POINTS", { player: "a1", points: 2 });
  m.push("PLAYER_POINTS", { player: "b1", points: 12 });
  assert.equal(score(), before, "the sets, the rallies, the serve and the team's figures are untouched");
  assert.equal(m.env.sport.players.a1.manualPoints, 5, "the player's total adds up");
  assert.equal(pointsScored(m.env.sport.players.a1), 5, "added points count towards the player's points");
  assert.deepEqual(E.mirrorScore(m.env.sport), { scoreA: 0, scoreB: 0 }, "the fixture's score is untouched");

  const teams = E.calculateTeamStatistics(m.env.sport, ctx, m.rules)[0];
  assert.equal(teams.rows[0].values.points, 1, "the team's points are still only the rally it won");
  assert.equal(teams.columns.some((c) => c.key === "manualPoints"), false, "no added points on the team table");
});

section("volleyball: player points while paused, after the match, on a quick result", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.push("MATCH_PAUSE", {});
  m.push("PLAYER_POINTS", { player: "a2", points: 1 });
  m.refuses("RALLY_WON", { winner: "a" }, /paused/, "rally scoring stays closed while paused");
  m.push("MATCH_RESUME", {});
  m.push("FINAL_SETS", { sets: [{ a: 5, b: 1 }, { a: 5, b: 2 }] });
  m.push("PLAYER_POINTS", { player: "a2", points: 4 });
  m.push("MATCH_COMPLETE", {});
  const sets = JSON.stringify(m.env.sport.sets);
  m.push("PLAYER_POINTS", { player: "b3", points: 7 });
  assert.equal(m.env.status, "completed", "adding points does not reopen the match");
  assert.equal(JSON.stringify(m.env.sport.sets), sets, "the entered set scores stand");
  m.refuses("RALLY_WON", { winner: "a" }, /over/, "rally scoring stays closed once it is over");
  const lines = E.calculateStatistics(m.env.sport, ctx, m.rules).lines.filter((l) => l.subject === "player");
  assert.equal(lines.find((l) => l.subjectKey === "a2").raw.manualPoints, 5);
  assert.equal(lines.find((l) => l.subjectKey === "b3").raw.manualPoints, 7);
  assert.equal(lines.length, 2, "nobody gets a line they weren't given: no fabricated figures");
});

section("volleyball: player points are refused for a match nobody played", () => {
  const w = openMatch(E, ctx, SHORT);
  w.push("MATCH_FORFEIT", { side: "b" });
  w.refuses("PLAYER_POINTS", { player: "a1", points: 2 }, /walkover/, "after a walkover");
  const c = openMatch(E, ctx, SHORT);
  c.push("MATCH_CANCEL", {});
  c.refuses("PLAYER_POINTS", { player: "a1", points: 2 }, /called off/, "after a cancellation");
});

section("volleyball: undoing and correcting player points", () => {
  const stored = (seq, type, payload, extra = {}) => ({ id: `e${seq}`, seq, type, payload, occurredAt: "2026-11-02T00:00:00.000Z", clientId: `c${seq}`, ...extra });
  const base = [
    stored(1, "MATCH_START", {}),
    stored(2, "FINAL_SETS", { sets: [{ a: 5, b: 1 }, { a: 5, b: 2 }] }),
    stored(3, "MATCH_COMPLETE", {}),
    stored(4, "PLAYER_POINTS", { player: "a1", points: 3 }),
    stored(5, "PLAYER_POINTS", { player: "a1", points: 2 }),
  ];
  const total = (events) => reconstruct(E, ctx, E.resolveRules(SHORT), events);
  assert.equal(total(base).envelope.sport.players.a1.manualPoints, 5);
  const undone = total([...base, stored(6, "CORRECTION_VOID", {}, { voidsEventId: "e5", reason: "Undone by the scorer" })]);
  assert.equal(undone.envelope.sport.players.a1.manualPoints, 3, "undo takes the last adjustment off");
  assert.equal(undone.envelope.status, "completed", "undo leaves the match finished");
  const fixed = total([...base, stored(6, "PLAYER_POINTS", { player: "a1", points: 4 }, { replacesEventId: "e4", reason: "Misread the sheet" })]);
  assert.equal(fixed.envelope.sport.players.a1.manualPoints, 6, "a correction replaces the amount");
  assert.equal(fixed.issues.filter((i) => i.severity === "error").length, 0);
  assert.deepEqual(E.mirrorScore(fixed.envelope.sport), { scoreA: 2, scoreB: 0 }, "the result stands through corrections");
});
