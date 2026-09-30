import assert from "node:assert/strict";
import { basketballEngine as E, leadStats, scoringRunsOf, possessions } from "../../src/lib/intelligence/sports/basketball.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { makeContext, openMatch, section, cell, card } from "./harness.mjs";

const ctx = makeContext("basketball", 6);
const made = (side, player, points, extra = {}) => ["SHOT_MADE", { side, player, points, ...extra }];

// Q1 5-4, Q2 5-8, Q3 11-8, Q4 11-11, OT 12-11
function fullGame() {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.push("PERIOD_START");
  m.push(...made("a", "a1", 2, { paint: true }));
  m.push(...made("a", "a2", 3, { assist: "a1" }));
  m.push("FREE_THROW_MADE", { side: "b", player: "b1" });
  m.push("FREE_THROW_MISSED", { side: "b", player: "b1" });
  m.push("SHOT_MISSED", { side: "a", player: "a1", points: 2 });
  m.push("REBOUND", { side: "b", player: "b2", offensive: false });
  m.push(...made("b", "b1", 3));
  m.push("PERIOD_END");
  m.push("PERIOD_START");
  m.push(...made("b", "b2", 2, { fastBreak: true }));
  m.push(...made("b", "b2", 2, { secondChance: true }));
  m.push("TURNOVER", { side: "a", player: "a1" });
  m.push("STEAL", { side: "b", player: "b3" });
  m.push("PERIOD_END");
  m.push("PERIOD_START");
  m.push(...made("a", "a2", 3));
  m.push(...made("a", "a2", 3));
  m.push("PERIOD_END");
  m.push("PERIOD_START");
  m.push(...made("b", "b1", 3));
  m.push("PERIOD_END");
  return m;
}

section("basketball: free throw 1, field goal 2, three 3", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push("FREE_THROW_MADE", { side: "a", player: "a1" });
  assert.equal(m.env.sport.score.a, 1);
  m.push(...made("a", "a1", 2));
  assert.equal(m.env.sport.score.a, 3);
  m.push(...made("a", "a1", 3));
  assert.equal(m.env.sport.score.a, 6);
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 4 }, /worth 2 or 3/, "4 point basket");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 1 }, /worth 2 or 3/, "1 point field goal");
});

section("basketball: Q1 to Q4 to overtime, score by period", () => {
  const m = fullGame();
  assert.deepEqual(m.env.sport.score, { a: 11, b: 11 });
  m.refuses("MATCH_COMPLETE", {}, /level. Play overtime/, "tied after regulation");
  assert.match(m.summary().view.notes.join(" "), /overtime/);
  m.push("PERIOD_START");
  assert.equal(m.summary().view.periodLabel.startsWith("OT"), true);
  m.push("FREE_THROW_MADE", { side: "a", player: "a1" });
  m.refuses("MATCH_COMPLETE", {}, /still in progress/, "OT still open");
  m.push("PERIOD_END");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.status, "completed");
  assert.deepEqual(m.env.result, { outcome: "win", winner: "a", method: "played", margin: "12-11, OT" });
  assert.deepEqual(m.env.sport.byPeriod, { a: [5, 0, 6, 0, 1], b: [4, 4, 0, 3, 0] });
  assert.deepEqual(m.summary().view.periods.map((p) => p.label), ["Q1", "Q2", "Q3", "Q4", "OT"]);
  assert.deepEqual(E.mirrorScore(m.env.sport, ctx, m.rules), { scoreA: 12, scoreB: 11 });
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2 }, /over/, "scoring after completion");
  m.assertReconstructs("full game");
});

section("basketball: overtime only when level", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  for (let q = 1; q <= 4; q++) { m.push("PERIOD_START"); if (q === 1) m.push(...made("a", "a1", 2)); m.push("PERIOD_END"); }
  m.refuses("PERIOD_START", {}, /only played when the score is level/, "OT at 2-0");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "2-0");
});

section("basketball: a tie is allowed only when the format says so", () => {
  const m = openMatch(E, ctx, { allowTie: true });
  m.push("MATCH_START");
  for (let q = 1; q <= 4; q++) { m.push("PERIOD_START"); m.push("PERIOD_END"); }
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.outcome, "tie");
});

section("basketball: configurable formats (12 minute quarters, 3x3 values)", () => {
  const nba = openMatch(E, ctx, { periodMinutes: 12, foulLimit: 6 });
  nba.push("MATCH_START"); nba.push("PERIOD_START");
  assert.equal(nba.env.sport.clock, 720);
  const x3 = openMatch(E, ctx, { twoPointValue: 1, threePointValue: 2, periods: 1, playersOnCourt: 3 });
  x3.push("MATCH_START"); x3.push("PERIOD_START");
  x3.push(...made("a", "a1", 2));
  assert.equal(x3.env.sport.team.a.tpm, 1, "in 3x3 the 2 is the shot from outside the arc");
  x3.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3 }, /worth 1 or 2/, "3 in 3x3");
  assert.throws(() => E.resolveRules({ periods: 0 }), RulesError);
  assert.throws(() => E.resolveRules({ twoPointValue: 3 }), RulesError);
});

section("basketball: player statistics and derived percentages", () => {
  const m = fullGame();
  const box = m.stats().players;
  assert.equal(cell(box, "box", "a1", "pts"), 2);
  assert.equal(cell(box, "box", "a1", "fgm"), 1);
  assert.equal(cell(box, "box", "a1", "fga"), 2);
  assert.equal(cell(box, "box", "a1", "fgPct"), 50);
  assert.equal(cell(box, "box", "a1", "ast"), 1);
  assert.equal(cell(box, "box", "a1", "tov"), 1);
  assert.equal(cell(box, "box", "a1", "astTov"), 1);
  assert.equal(cell(box, "box", "a2", "pts"), 9);
  assert.equal(cell(box, "box", "a2", "tpPct"), 100);
  assert.equal(cell(box, "box", "b1", "pts"), 7);
  assert.equal(cell(box, "box", "b1", "ftPct"), 50);
  assert.equal(cell(box, "box", "b2", "dreb"), 1);
  assert.equal(cell(box, "box", "b2", "reb"), 1);
  assert.equal(cell(box, "box", "b3", "stl"), 1);
  // no attempts: a percentage does not exist, it is not 0%
  assert.equal(cell(box, "box", "a3", "fgPct"), null);
  assert.equal(cell(box, "box", "a2", "ftPct"), null);
  assert.equal(cell(box, "box", "a2", "astTov"), null, "no turnovers: the ratio is undefined");
});

section("basketball: team analytics", () => {
  const m = fullGame();
  const t = m.stats().teams;
  assert.equal(cell(t, "team", "a", "pts"), 11);
  assert.equal(cell(t, "team", "a", "paintPts"), 2);
  assert.equal(cell(t, "team", "b", "fastBreakPts"), 2);
  assert.equal(cell(t, "team", "b", "secondChancePts"), 2);
  assert.equal(cell(t, "team", "a", "fgPct"), 80);           // 4 of 5
  assert.equal(cell(t, "team", "a", "efgPct"), 110);         // (4 + 0.5*3) / 5
  assert.equal(cell(t, "team", "a", "possessions"), 6);      // 5 FGA + 0 FTA - 0 ORB + 1 TOV
  assert.equal(cell(t, "team", "a", "offRating"), 183.3);    // 100 * 11 / 6
  assert.equal(cell(t, "team", "a", "tovRate"), 16.7);
  assert.equal(possessions(m.env.sport.team.b), 4 + 0.44 * 2); // 4.88
  assert.equal(cell(t, "team", "a", "defRating"), 225.4);    // 100 * 11 / 4.88
  assert.equal(cell(t, "team", "a", "ptsPerPeriod"), 2.8);   // 11 over 4 periods
  assert.equal(cell(t, "team", "a", "benchPts"), null, "no starters were recorded");
  assert.equal(cell(t, "team", "a", "orebRate"), 0);         // 0 / (0 + 1 opponent DREB)
  assert.equal(cell(t, "team", "b", "orebRate"), null, "no rebounds at that end: undefined, not 0");
});

section("basketball: lead changes, largest lead and scoring runs", () => {
  const m = fullGame();
  assert.deepEqual(leadStats(m.env.sport.scoring), { leadChanges: 2, timesTied: 2, largestLead: { a: 5, b: 3 } });
  assert.deepEqual(scoringRunsOf(m.env.sport.scoring, 6), [{ side: "b", points: 8, period: 1 }, { side: "a", points: 6, period: 3 }]);
  const an = m.analytics();
  assert.equal(card(an, "Lead changes"), "2");
  const prog = an.charts.find((c) => c.key === "progression");
  assert.deepEqual(prog.series[0].values, [0, 2, 5, 5, 5, 5, 5, 8, 11, 11]);
  assert.deepEqual(prog.series[1].values, [0, 0, 0, 1, 4, 6, 8, 8, 8, 11]);
  const byPeriod = an.charts.find((c) => c.key === "by-period");
  assert.deepEqual(byPeriod.series[0].values, [5, 0, 6, 0]);
});

section("basketball: metrics are withheld when the data is insufficient", () => {
  const m = openMatch(E, ctx, { trackShotAttempts: false });
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push(...made("a", "a1", 2));
  const s = m.stats();
  assert.equal(cell(s.players, "box", "a1", "fgPct"), null, "misses are not tracked, so 1 of 1 is not 100%");
  assert.equal(cell(s.teams, "team", "a", "offRating"), null);
  assert.equal(cell(s.players, "box", "a1", "min"), null, "no lineups: minutes unknown");
  assert.equal(cell(s.players, "box", "a1", "plusMinus"), null);
  assert.equal(cell(s.players, "box", "a1", "ptsPerMin"), null);
});

section("basketball: minutes, plus/minus and bench points with lineups and a clock", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  m.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
  m.push("PERIOD_START");
  m.push("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 540 });
  m.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1", clock: 300 });
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 290 }, /not on court/, "benched player scoring");
  m.refuses("SUBSTITUTION", { side: "a", in: "a6", out: "a2", clock: 280 }, /already on court/, "double sub in");
  m.refuses("SHOT_MADE", { side: "a", player: "a6", points: 2, clock: 310 }, /cannot run backwards/, "clock going up");
  m.push("SHOT_MADE", { side: "a", player: "a6", points: 3, clock: 120 });
  m.push("PERIOD_END");
  const box = m.stats().players;
  assert.equal(cell(box, "box", "a1", "min"), 5);
  assert.equal(cell(box, "box", "a6", "min"), 5);
  assert.equal(cell(box, "box", "a2", "min"), 10);
  assert.equal(cell(box, "box", "a1", "ptsPerMin"), 0.4);
  assert.equal(cell(box, "box", "a1", "plusMinus"), 2);
  assert.equal(cell(box, "box", "a6", "plusMinus"), 3);
  assert.equal(cell(box, "box", "a2", "plusMinus"), 5);
  assert.equal(cell(box, "box", "b1", "plusMinus"), -5);
  assert.equal(cell(m.stats().teams, "team", "a", "benchPts"), 3);
  m.assertReconstructs("lineups");

  const noClock = openMatch(E, ctx);
  noClock.push("MATCH_START");
  noClock.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  noClock.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
  noClock.push("PERIOD_START");
  noClock.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1" });
  assert.equal(cell(noClock.stats().players, "box", "a6", "min"), null, "a substitution without a clock makes minutes unknowable");
});

section("basketball: invalid participation is refused", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.refuses("SHOT_MADE", { side: "a", player: "b1", points: 2 }, /not in Alpha/, "opponent's player");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, assist: "a1" }, /own basket/, "self assist");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3, paint: true }, /not in the paint/, "three in the paint");
  m.refuses("SHOT_MISSED", { side: "a", player: "a1", points: 2, assist: "a2" }, /no assist/, "assist on a miss");
  m.refuses("REBOUND", { side: "a", player: "a1" }, /offensive or defensive/, "untyped rebound");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2"] }, /exactly 5/, "short lineup");
  m.refuses("SUBSTITUTION", { side: "a", in: "a6", out: "a1" }, /Set the lineup/, "sub before lineup");
  for (let i = 0; i < 5; i++) m.push("FOUL", { side: "a", player: "a5", kind: i === 4 ? "technical" : "personal" });
  m.refuses("SHOT_MADE", { side: "a", player: "a5", points: 2 }, /fouled out/, "fouled out player");
  assert.ok(E.derivedLog(m.env.sport).some((l) => /Alpha 5 fouled out/.test(l.text)));
});

section("basketball: reconstruction checks the score against the baskets", () => {
  const m = fullGame();
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  const tampered = structuredClone(m.env.sport);
  tampered.score.a = 99;
  assert.ok(E.validateScore(tampered, ctx, m.rules).some((i) => i.code === "IMPOSSIBLE_SCORE"));
});

section("basketball: historical averages come from summed raw counters", () => {
  const g1 = fullGame();
  const g2 = openMatch(E, ctx);
  g2.push("MATCH_START"); g2.push("PERIOD_START");
  g2.push(...made("a", "a2", 2)); g2.push("SHOT_MISSED", { side: "a", player: "a2", points: 3 });
  g2.push("REBOUND", { side: "a", player: "a2", offensive: true });
  const lines = [g1, g2].map((g) => g.stats().lines.find((l) => l.subject === "player" && l.subjectKey === "a2").raw);
  const agg = aggregate(E, "player", lines);
  assert.equal(agg.contests, 2);
  assert.equal(agg.values.pts, 11);
  assert.equal(agg.values.ppg, 5.5);
  assert.equal(agg.values.rpg, 0.5);
  assert.equal(agg.values.fgPct, 80);     // 4 of 5 across both games, not the mean of 100% and 50%
  assert.equal(agg.values.tpPct, 75);     // 3 of 4
  const team = aggregate(E, "team", [g1.stats().lines.find((l) => l.subject === "team" && l.side === "a").raw]);
  assert.equal(team.values.ppg, 11);
  assert.equal(team.values.defRating, 225.4);
});
