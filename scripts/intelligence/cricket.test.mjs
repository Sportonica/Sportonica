import assert from "node:assert/strict";
import { cricketEngine as E, oversText, parseOvers, runRate } from "../../src/lib/intelligence/sports/cricket.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { makeContext, openMatch, section, cell, card } from "./harness.mjs";

const ctx = makeContext("cricket", 6);
// A short format so a whole match fits in a test: 2 overs, 3 wickets.
const SHORT = { preset: "custom", oversPerInnings: 2, wicketsPerInnings: 3, maxOversPerBowler: 1 };

const ball = (m, striker, nonStriker, bowler, extra = {}) => m.push("DELIVERY", { striker, nonStriker, bowler, runsBat: 0, ...extra });

// Alpha bat first: 21 all out in 1.3 overs.
function firstInnings(rules = SHORT) {
  const m = openMatch(E, ctx, rules);
  m.push("MATCH_START");
  m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball(m, "a1", "a2", "b1", { runsBat: 1 });                       // 1      legal 1
  ball(m, "a2", "a1", "b1", { extra: "wide" });                    // 2      (wide)
  ball(m, "a2", "a1", "b1", { extra: "no_ball", runsBat: 4 });     // 7      (no-ball + four)
  ball(m, "a2", "a1", "b1", { runsBat: 4 });                       // 11     legal 2
  ball(m, "a2", "a1", "b1", { wicket: { type: "bowled" } });       // 11/1   legal 3
  m.push("NEW_BATTER", { player: "a3" });
  ball(m, "a3", "a1", "b1");                                       // dot    legal 4
  ball(m, "a3", "a1", "b1", { extra: "leg_bye", extraRuns: 2 });   // 13     legal 5
  ball(m, "a3", "a1", "b1", { runsBat: 6 });                       // 19     legal 6, over
  ball(m, "a1", "a3", "b2", { runsBat: 1 });                       // 20     1.1
  ball(m, "a3", "a1", "b2", { runsBat: 1, wicket: { type: "run_out", player: "a1", fielder: "b4" } }); // 21/2  1.2
  m.push("NEW_BATTER", { player: "a4" });
  ball(m, "a4", "a3", "b2", { wicket: { type: "caught", fielder: "b3" } }); // 21/3 all out 1.3
  return m;
}

section("cricket: overs are balls, not decimals", () => {
  assert.equal(parseOvers("4.5"), 29, "4.5 overs is 4 overs and 5 balls");
  assert.equal(oversText(29), "4.5");
  assert.equal(parseOvers("4.6"), null, "there is no sixth ball after the decimal point");
  assert.equal(parseOvers("20"), 120);
  assert.equal(oversText(120), "20.0");
  assert.equal(parseOvers("3.4", 5), 19, "five-ball overs");
  // 30 runs from 4.5 overs is 6.21 an over, not 30 / 4.5 = 6.67
  assert.equal(Number(runRate(30, 29).toFixed(2)), 6.21);
  assert.notEqual(Number(runRate(30, 29).toFixed(2)), Number((30 / 4.5).toFixed(2)));
  assert.equal(runRate(10, 0), null);
});

section("cricket: legal ball, wide, no-ball, four, wicket", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  const inn = () => m.env.sport.innings[0];
  ball(m, "a1", "a2", "b1", { runsBat: 1 });
  assert.deepEqual([inn().runs, inn().balls], [1, 1]);
  ball(m, "a2", "a1", "b1", { extra: "wide" });
  assert.deepEqual([inn().runs, inn().balls], [2, 1], "a wide adds a run without using a ball");
  assert.equal(inn().batters.a2.balls, 0, "a wide is not a ball faced");
  ball(m, "a2", "a1", "b1", { extra: "no_ball", runsBat: 4 });
  assert.deepEqual([inn().runs, inn().balls], [7, 1], "a no-ball adds the penalty and the bat runs without using a ball");
  assert.deepEqual([inn().batters.a2.runs, inn().batters.a2.balls, inn().batters.a2.fours], [4, 1, 1], "a no-ball is a ball faced");
  ball(m, "a2", "a1", "b1", { runsBat: 4 });
  assert.deepEqual([inn().runs, inn().balls], [11, 2]);
  ball(m, "a2", "a1", "b1", { wicket: { type: "bowled" } });
  assert.deepEqual([inn().runs, inn().wickets, inn().balls], [11, 1, 3]);
  assert.equal(oversText(inn().balls), "0.3");
  assert.deepEqual(inn().overs[0].balls, ["1", "1wd", "5nb", "4", "W"]);
  assert.deepEqual(inn().extras, { wides: 1, noBalls: 1, byes: 0, legByes: 0, penalty: 0 });
  m.refuses("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0 }, /new batter/i, "bowling with a batter missing");
});

section("cricket: first innings scorecard", () => {
  const m = firstInnings();
  const inn = m.env.sport.innings[0];
  assert.deepEqual([inn.runs, inn.wickets, inn.balls, inn.closed], [21, 3, 9, "all_out"]);
  const p = m.stats().players;
  // batting
  assert.deepEqual([cell(p, "bat-1", "a1", "runs"), cell(p, "bat-1", "a1", "balls")], [2, 2]);
  assert.deepEqual([cell(p, "bat-1", "a2", "runs"), cell(p, "bat-1", "a2", "balls"), cell(p, "bat-1", "a2", "fours")], [8, 3, 2]);
  assert.equal(cell(p, "bat-1", "a2", "sr"), 266.67);
  assert.deepEqual([cell(p, "bat-1", "a3", "runs"), cell(p, "bat-1", "a3", "balls"), cell(p, "bat-1", "a3", "sixes")], [7, 4, 1]);
  assert.equal(cell(p, "bat-1", "a3", "sr"), 175);
  assert.equal(cell(p, "bat-1", "a3", "how"), "not out");
  assert.equal(cell(p, "bat-1", "a2", "how"), "b Bravo 1");
  assert.equal(cell(p, "bat-1", "a1", "how"), "run out (Bravo 4)");
  assert.equal(cell(p, "bat-1", "a4", "how"), "c Bravo 3 b Bravo 2");
  // bowling: byes and leg-byes are not the bowler's; a run out is not the bowler's wicket
  assert.deepEqual([cell(p, "bowl-1", "b1", "overs"), cell(p, "bowl-1", "b1", "runs"), cell(p, "bowl-1", "b1", "wickets")], ["1.0", 17, 1]);
  assert.deepEqual([cell(p, "bowl-1", "b1", "wides"), cell(p, "bowl-1", "b1", "noBalls"), cell(p, "bowl-1", "b1", "econ")], [1, 1, 17]);
  assert.deepEqual([cell(p, "bowl-1", "b2", "overs"), cell(p, "bowl-1", "b2", "runs"), cell(p, "bowl-1", "b2", "wickets")], ["0.3", 2, 1]);
  assert.equal(cell(p, "bowl-1", "b2", "econ"), 4, "2 runs from 3 balls is 4 an over");
  assert.equal(cell(p, "bowl-1", "b2", "sr"), 3);
  assert.equal(cell(p, "bowl-1", "b1", "avg"), 17);
  // team
  const t = m.stats().teams;
  assert.deepEqual([cell(t, "innings", "inn-1", "runs"), cell(t, "innings", "inn-1", "overs"), cell(t, "innings", "inn-1", "extras")], [21, "1.3", 4]);
  assert.equal(cell(t, "innings", "inn-1", "rr"), 14);
  assert.deepEqual([cell(t, "innings", "inn-1", "fours"), cell(t, "innings", "inn-1", "sixes"), cell(t, "innings", "inn-1", "legByes")], [2, 1, 2]);
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  m.assertReconstructs("first innings");
});

section("cricket: partnerships and fall of wickets", () => {
  const m = firstInnings();
  const inn = m.env.sport.innings[0];
  assert.deepEqual(inn.fow.map((f) => `${f.wicket}-${f.runs} (${oversText(f.balls)})`), ["1-11 (0.3)", "2-21 (1.2)", "3-21 (1.3)"]);
  assert.deepEqual(inn.partnerships.map((s) => [s.wicket, s.runs, s.balls]), [[1, 11, 3], [2, 10, 5], [3, 0, 1]]);
  const tables = m.analytics().tables;
  assert.equal(cell(tables, "partnerships-1", "1-1", "batters"), "Alpha 1 and Alpha 2");
  assert.equal(cell(tables, "fow-1", "1-2", "score"), "21/2");
});

section("cricket: target, required runs and a win by wickets", () => {
  const m = firstInnings();
  m.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  assert.equal(m.env.sport.innings[1].target, 22);
  for (const r of [6, 6, 4, 1]) ball(m, "b1", "b2", "a1", { runsBat: r });
  ball(m, "b2", "b1", "a1");
  ball(m, "b2", "b1", "a1", { runsBat: 1 });
  assert.deepEqual(m.summary().lines, ["Bravo 18/0", "1.0 overs", "Target: 22", "Required: 4 runs from 6 balls"]);
  const an = m.analytics();
  assert.equal(card(an, "Current run rate"), "18.00");
  assert.equal(card(an, "Required run rate"), "4.00");
  assert.equal(card(an, "Target"), "22");
  m.refuses("MATCH_COMPLETE", {}, /not decided/, "completing mid-chase");
  ball(m, "b2", "b1", "a2", { runsBat: 4 });
  assert.equal(m.env.sport.innings[1].closed, "target");
  assert.deepEqual(m.env.sport.result, { outcome: "win", winner: "b", method: "played", margin: "by 3 wickets" });
  m.refuses("DELIVERY", { striker: "b2", nonStriker: "b1", bowler: "a2", runsBat: 1 }, /already decided/, "ball after the winning run");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.winner, "b");
  assert.deepEqual(E.mirrorScore(m.env.sport, ctx, m.rules), { scoreA: 21, scoreB: 22, cricket: { wicketsA: 3, wicketsB: 0, oversA: 1.3, oversB: 1.1, target: 22 } });
  const worm = m.analytics().charts.find((c) => c.key === "worm");
  assert.deepEqual(worm.series[0].values, [0, 19, 21]);
  assert.deepEqual(worm.series[1].values, [0, 18, 22]);
  m.assertReconstructs("chase");
});

section("cricket: defending a total: win by runs, and a tie", () => {
  const byRuns = firstInnings();
  byRuns.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  ball(byRuns, "b1", "b2", "a1", { runsBat: 4 }); ball(byRuns, "b1", "b2", "a1", { runsBat: 6 });
  for (let i = 0; i < 4; i++) ball(byRuns, "b1", "b2", "a1");
  for (let i = 0; i < 6; i++) ball(byRuns, "b2", "b1", "a2");
  assert.equal(byRuns.env.sport.innings[1].closed, "overs");
  assert.deepEqual(byRuns.env.sport.result, { outcome: "win", winner: "a", method: "played", margin: "by 11 runs" });
  assert.equal(byRuns.env.sport.innings[1].bowlers.a2.maidens, 1, "six dot balls is a maiden");
  assert.equal(byRuns.env.sport.innings[1].bowlers.a1.maidens, 0);

  const tie = firstInnings();
  tie.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  for (const r of [6, 6, 6]) ball(tie, "b1", "b2", "a1", { runsBat: r });
  ball(tie, "b1", "b2", "a1", { runsBat: 1 }); ball(tie, "b2", "b1", "a1", { runsBat: 1 }); ball(tie, "b1", "b2", "a1", { runsBat: 1 });
  for (let i = 0; i < 6; i++) ball(tie, "b1", "b2", "a2");
  assert.deepEqual([tie.env.sport.innings[1].runs, tie.env.sport.result.outcome], [21, "tie"]);
  tie.push("MATCH_COMPLETE");
  assert.equal(tie.env.result.outcome, "tie");
});

section("cricket: impossible deliveries are refused", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.refuses("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1" }, /Start an innings/, "no innings");
  m.push("TOSS", { winner: "b", decision: "bowl" });
  m.refuses("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" }, /Alpha bats/, "wrong side after the toss");
  m.refuses("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a1" }, /different players/, "same opener twice");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  const d = (extra) => ({ striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0, ...extra });
  m.refuses("DELIVERY", d({ extra: "wide", runsBat: 2 }), /no runs off the bat on a wide/, "bat runs on a wide");
  m.refuses("DELIVERY", d({ extra: "no_ball", wicket: { type: "bowled" } }), /cannot be out bowled off a no-ball/, "bowled off a no-ball");
  m.refuses("DELIVERY", d({ extra: "wide", wicket: { type: "lbw" } }), /cannot be out lbw off a wide/, "lbw off a wide");
  m.refuses("DELIVERY", d({ extra: "bye" }), /at least one run/, "bye with no runs");
  m.refuses("DELIVERY", d({ extraRuns: 2 }), /need an extra type/, "unexplained extra runs");
  m.refuses("DELIVERY", d({ bowler: "a3" }), /fielding side/, "bowler from the batting side");
  m.refuses("DELIVERY", d({ striker: "a5" }), /two batters at the crease/, "striker not at the crease");
  m.refuses("DELIVERY", d({ wicket: { type: "bowled", player: "a2" } }), /Only the striker/, "non-striker bowled");
  m.refuses("DELIVERY", d({ runsBat: 2, wicket: { type: "caught" } }), /No runs are scored/, "runs on a catch");
  m.refuses("DELIVERY", d({ runsBat: 1.5 }), /whole numbers/, "fractional runs");
  m.refuses("DECLARE", {}, /not allowed/, "declaring in a limited overs match");
  m.push("DELIVERY", d({ extra: "wide", wicket: { type: "stumped", fielder: "b2" } }));
  assert.equal(m.env.sport.innings[0].bowlers.b1.wickets, 1, "a stumping off a wide is the bowler's wicket");
  m.refuses("DELIVERY", d({ bowler: "b2" }), /new batter/i, "next ball before the new batter");
  m.push("NEW_BATTER", { player: "a3" });
  m.refuses("NEW_BATTER", { player: "a4" }, /already at the crease/, "third batter");
  m.refuses("DELIVERY", { striker: "a3", nonStriker: "a2", bowler: "b2", runsBat: 0 }, /cannot change during an over/, "new bowler mid-over");
});

section("cricket: bowler restrictions and maidens", () => {
  const m = openMatch(E, ctx, { ...SHORT, oversPerInnings: 3 });
  m.push("MATCH_START");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  for (let i = 0; i < 5; i++) ball(m, "a1", "a2", "b1");
  ball(m, "a1", "a2", "b1", { extra: "bye", extraRuns: 1 });
  assert.equal(m.env.sport.innings[0].bowlers.b1.maidens, 1, "byes do not spoil a maiden");
  m.refuses("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0 }, /two overs in a row/, "consecutive overs");
  for (let i = 0; i < 6; i++) ball(m, "a1", "a2", "b2", i === 0 ? { extra: "wide" } : {});
  ball(m, "a1", "a2", "b2");
  assert.equal(m.env.sport.innings[0].bowlers.b2.maidens, 0, "a wide spoils a maiden");
  m.refuses("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0 }, /maximum 1 overs/, "bowler over the limit");
});

section("cricket: free hit after a no-ball (T20)", () => {
  const m = openMatch(E, ctx, { preset: "t20" });
  assert.equal(m.rules.oversPerInnings, 20);
  m.push("MATCH_START");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball(m, "a1", "a2", "b1", { extra: "no_ball" });
  assert.equal(m.env.sport.innings[0].freeHit, true);
  m.refuses("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0, wicket: { type: "bowled" } }, /free hit/, "bowled on a free hit");
  ball(m, "a1", "a2", "b1", { extra: "wide" });
  assert.equal(m.env.sport.innings[0].freeHit, true, "a wide does not use up the free hit");
  ball(m, "a1", "a2", "b1", { runsBat: 1, wicket: { type: "run_out", player: "a2" } });
  assert.equal(m.env.sport.innings[0].wickets, 1, "a run out stands on a free hit");
  assert.equal(m.env.sport.innings[0].freeHit, false);
});

section("cricket: retired hurt is not a wicket and the batter can return", () => {
  const m = openMatch(E, ctx, SHORT);
  m.push("MATCH_START");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball(m, "a1", "a2", "b1", { runsBat: 4 });
  m.push("RETIRE", { player: "a1", kind: "hurt" });
  assert.equal(m.env.sport.innings[0].wickets, 0);
  m.push("NEW_BATTER", { player: "a3" });
  ball(m, "a3", "a2", "b1", { wicket: { type: "lbw" } });
  m.push("NEW_BATTER", { player: "a1" });
  ball(m, "a1", "a2", "b1", { runsBat: 2 });
  assert.deepEqual([m.env.sport.innings[0].batters.a1.runs, m.env.sport.innings[0].batters.a1.balls], [6, 2], "the returning batter carries on their innings");
  m.push("RETIRE", { player: "a2", kind: "out" });
  assert.equal(m.env.sport.innings[0].wickets, 2, "retired out is a wicket");
  assert.equal(m.env.sport.innings[0].bowlers.b1.wickets, 1, "but not the bowler's");
  m.refuses("NEW_BATTER", { player: "a3" }, /already out/, "a dismissed batter returning");
});

section("cricket: penalty runs and a revised target", () => {
  const m = firstInnings();
  m.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  m.push("PENALTY_RUNS", { side: "a", runs: 5 });
  assert.equal(m.env.sport.innings[0].runs, 26);
  assert.equal(m.env.sport.innings[1].target, 27, "penalty runs to the side that batted first raise the target");
  ball(m, "b1", "b2", "a1", { runsBat: 6 });
  m.refuses("TARGET_REVISED", { target: 0 }, /positive/, "zero target");
  m.push("TARGET_REVISED", { target: 12, maxOvers: 1 });
  assert.equal(m.env.sport.innings[1].maxBalls, 6);
  ball(m, "b1", "b2", "a1", { runsBat: 6 });
  assert.deepEqual([m.env.sport.innings[1].closed, m.env.sport.result.winner], ["target", "b"]);
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  m.assertReconstructs("revised target");
});

section("cricket: two innings a side: declaration, follow-on, innings victory, draw", () => {
  const rules = { preset: "test", wicketsPerInnings: 1, followOnLead: 5 };
  const m = openMatch(E, ctx, rules);
  assert.equal(m.rules.oversPerInnings, null, "a Test innings has no overs limit");
  m.push("MATCH_START");
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball(m, "a1", "a2", "b1", { runsBat: 6 }); ball(m, "a1", "a2", "b1", { runsBat: 6 });
  m.push("DECLARE");
  assert.equal(m.env.sport.innings[0].closed, "declared");
  assert.equal(m.summary().view.score.a, "12/0d");
  m.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  assert.equal(m.env.sport.innings[1].target, null, "no target until the last innings");
  ball(m, "b1", "b2", "a1", { wicket: { type: "bowled" } });
  assert.equal(m.env.sport.innings[1].closed, "all_out");
  assert.equal(m.env.sport.result, null);
  m.refuses("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" }, /Alpha bats/, "batting again without the follow-on");
  m.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2", followOn: true });
  ball(m, "b1", "b2", "a1", { runsBat: 4 });
  ball(m, "b1", "b2", "a1", { wicket: { type: "bowled" } });
  assert.deepEqual(m.env.sport.result, { outcome: "win", winner: "a", method: "played", margin: "by an innings and 8 runs" });
  assert.equal(m.summary().view.score.b, "0/1 & 4/1");

  const weak = openMatch(E, ctx, { ...rules, followOnLead: 50 });
  weak.push("MATCH_START");
  weak.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball(weak, "a1", "a2", "b1", { runsBat: 6 }); weak.push("DECLARE");
  weak.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  ball(weak, "b1", "b2", "a1", { wicket: { type: "bowled" } });
  weak.refuses("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2", followOn: true }, /lead of 50 is needed.*lead is 6/, "follow-on without the lead");
  // time runs out with the match undecided
  weak.push("MATCH_COMPLETE");
  assert.equal(weak.env.result.outcome, "draw");

  const t20 = openMatch(E, ctx, SHORT);
  t20.push("MATCH_START");
  t20.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  t20.refuses("MATCH_COMPLETE", {}, /not decided/, "a limited overs match has no draw");
  t20.push("MATCH_ABANDON", { reason: "Rain" });
  assert.equal(t20.env.result.outcome, "no_result");
});

section("cricket: phases", () => {
  const m = firstInnings({ ...SHORT, phases: [{ name: "Powerplay", from: 1, to: 1 }, { name: "Death", from: 2, to: 2 }] });
  const t = m.analytics().tables;
  assert.deepEqual([cell(t, "phases-1", "Powerplay", "runs"), cell(t, "phases-1", "Powerplay", "wickets"), cell(t, "phases-1", "Powerplay", "rr")], [19, 1, 19]);
  assert.deepEqual([cell(t, "phases-1", "Death", "runs"), cell(t, "phases-1", "Death", "wickets"), cell(t, "phases-1", "Death", "rr")], [2, 2, 4]);
});

section("cricket: correcting one ball keeps its place in the over", () => {
  const m = firstInnings();
  const four = m.events.find((e) => e.type === "DELIVERY" && e.payload.runsBat === 4 && !e.payload.extra);
  m.correct("replace", four.id, "Umpire signalled two, not four", "DELIVERY", { ...four.payload, runsBat: 2 });
  const inn = m.env.sport.innings[0];
  assert.equal(inn.runs, 19);
  assert.deepEqual(inn.overs[0].balls, ["1", "1wd", "5nb", "2", "W", "0", "2lb", "6"], "the corrected ball is still the fourth delivery");
  assert.equal(inn.batters.a2.runs, 6);
  assert.deepEqual(E.validateScore(inn && m.env.sport, ctx, m.rules), []);
  const labels = m.rebuild().labels;
  assert.equal(labels[m.events[m.events.length - 1].seq], "1st innings 0.2", "the replacement is labelled with the ball it replaced");
  // removing the wicket that ended the innings would leave a match with the innings still open: allowed,
  // but removing the opening batter's innings start is not
  const start = m.events.find((e) => e.type === "INNINGS_START");
  assert.throws(() => m.correct("void", start.id, "oops"), /not possible/);
});

section("cricket: career figures", () => {
  const m = firstInnings();
  m.push("INNINGS_START", { batting: "b", striker: "b1", nonStriker: "b2" });
  ball(m, "b1", "b2", "a1", { runsBat: 4 });
  const lines = m.stats().lines;
  const a3 = lines.find((l) => l.subjectKey === "a3").raw;
  assert.deepEqual([a3.batRuns, a3.batBalls, a3.notOuts, a3.dismissals ?? 0], [7, 4, 1, 0]);
  const a3agg = aggregate(E, "player", [a3, a3]);
  assert.equal(a3agg.values.batAvg, null, "never dismissed: no batting average, not infinity or 14");
  assert.equal(a3agg.values.batSr, 175);
  const a2 = lines.find((l) => l.subjectKey === "a2").raw;
  const a2agg = aggregate(E, "player", [a2, { matches: 1, batInnings: 1, batRuns: 22, batBalls: 17, dismissals: 1 }]);
  assert.equal(a2agg.values.batAvg, 15);                     // 30 runs, 2 dismissals
  assert.equal(a2agg.values.batSr, 150);                     // 30 off 20
  const b1 = lines.find((l) => l.subjectKey === "b1").raw;
  assert.deepEqual([b1.wickets, b1.bowlRuns, b1.bowlBalls], [1, 17, 6]);
  assert.equal(aggregate(E, "player", [b1]).values.econ, 17);
  const b3 = lines.find((l) => l.subjectKey === "b3").raw;
  assert.equal(b3.catches, 1);
  const b4 = lines.find((l) => l.subjectKey === "b4").raw;
  assert.equal(b4.runOuts, 1);
  assert.equal(aggregate(E, "player", [lines.find((l) => l.subjectKey === "b5").raw]).values.bowlAvg, null);
});
