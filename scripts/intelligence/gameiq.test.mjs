// Game IQ for the sports without their own answerer (basketball has one):
// questions answered from the match's recorded figures and the
// competition's rules, the glossary, "why did the score change", and the
// "How scoring works" guide.
import assert from "node:assert/strict";
import { cricketEngine as C } from "../../src/lib/intelligence/sports/cricket.ts";
import { volleyballEngine as V } from "../../src/lib/intelligence/sports/volleyball.ts";
import { badmintonEngine as B } from "../../src/lib/intelligence/sports/badminton.ts";
import { pickleballEngine as P } from "../../src/lib/intelligence/sports/pickleball.ts";
import { swimmingEngine as S } from "../../src/lib/intelligence/sports/swimming.ts";
import { parseDuration } from "../../src/lib/intelligence/core/util.ts";
import { makeContext, openMatch, section } from "./harness.mjs";

const asker = (E, m) => (q) => E.answerQuestion(m.env.sport, m.ctx, m.rules, q);

section("game iq: cricket answers from the scorecard, the Laws and each ball", () => {
  const ctx = makeContext("cricket", 11);
  const m = openMatch(C, ctx, { preset: "t20" });
  const ball = (striker, nonStriker, bowler, extra = {}) => m.push("DELIVERY", { striker, nonStriker, bowler, runsBat: 0, ...extra });
  m.push("MATCH_START");
  m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  ball("a1", "a2", "b1", { runsBat: 4 });
  ball("a1", "a2", "b1", { extra: "wide" });
  ball("a1", "a2", "b1", { runsBat: 1 });
  ball("a2", "a1", "b1", { wicket: { type: "bowled" } });
  const ask = asker(C, m);
  assert.match(ask("What is the score?").answer, /^Alpha 6\/1/);
  assert.equal(ask("How many runs has Alpha 1 scored?").answer, "Alpha 1: 5 runs.");
  assert.equal(ask("How many wickets has Bravo 1 taken?").answer, "Bravo 1: 1 wickets.");
  assert.equal(ask("Who has the best economy?").answer, "Bravo 1 leads with 12.00 economy (runs per over).");
  assert.equal(ask("Why did the score change?").answer, "Ball 0.3: a wicket, no run. Alpha's total did not change.");
  assert.match(ask("Why was there no run?").answer, /a wicket, no run/);
  const recent = C.answerQuestion(m.env.sport, ctx, m.rules, "why did the score change");
  assert.equal(recent.kind, "data");
  assert.match(ask("How many overs are there?").answer, /1 innings of 20 overs per side, 6 balls an over/);
  assert.match(ask("What happens on a no-ball?").answer, /free hit/);
  assert.match(ask("How many overs can a bowler bowl?").answer, /at most 4 overs/);
  assert.match(ask("What is LBW?").answer, /^LBW: Leg before wicket/);
  assert.equal(ask("What is the weather?").kind, "unknown");
  const test = openMatch(C, ctx, { preset: "test" });
  assert.match(C.answerQuestion(test.env.sport, ctx, test.rules, "How many overs are there?").answer, /2 innings per side, no over limit/);
  assert.match(C.answerQuestion(test.env.sport, ctx, test.rules, "What is the follow-on?").answer, /200 runs or more/);
  const guide = C.rulesGuide(m.rules);
  assert.deepEqual(guide.map((g) => g.title), ["Format", "Runs", "Result", "What the scorer records"]);
});

section("game iq: cricket explains every kind of ball", () => {
  const ctx = makeContext("cricket", 11);
  const m = openMatch(C, ctx, { preset: "t20" });
  m.push("MATCH_START"); m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  const ball = (extra) => m.push("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 0, ...extra });
  ball({ runsBat: 6 }); ball({ extra: "wide" }); ball({ extra: "no_ball", runsBat: 4 }); ball({ extra: "leg_bye", extraRuns: 2 });
  const texts = C.answerQuestion(m.env.sport, ctx, m.rules, "why").answer;
  assert.match(texts, /leg-byes \(off the body\)/);
  const all = m.env.sport.innings[0].overs[0].balls;
  assert.deepEqual(all, ["6", "1wd", "5nb", "2lb"]);
});

section("game iq: volleyball answers kills, rules and why a point was scored", () => {
  const ctx = makeContext("volleyball", 6);
  const six = (side) => Array.from({ length: 6 }, (_, i) => `${side}${i + 1}`);
  const m = openMatch(V, ctx);
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: six("a") });
  m.push("LINEUP", { side: "b", players: six("b") });
  m.push("FIRST_SERVE", { side: "a" });
  m.push("RALLY_WON", { winner: "a", how: "ace" });
  m.push("RALLY_WON", { winner: "a", how: "kill", player: "a3" });
  m.push("RALLY_WON", { winner: "b", how: "kill", player: "b4" });
  const ask = asker(V, m);
  assert.match(ask("What is the score?").answer, /\(Set 1/);
  assert.equal(ask("Who has the most kills?").answer, "Alpha 3 and Bravo 4 lead with 1 kills.");
  assert.equal(ask("Why did the score change?").answer, "Bravo scored because Bravo won the rally (a kill). It is 2-1 in set 1.");
  assert.match(ask("How many points win a set?").answer, /first team to 25 points with a 2-point lead; the deciding set 5 goes to 15/);
  assert.match(ask("What is a libero?").answer, /^Libero: /);
  assert.ok(V.rulesGuide(m.rules).length >= 4);
});

section("game iq: badminton and pickleball explain a point, and a side out with no point", () => {
  const bctx = makeContext("badminton", 1);
  const b = openMatch(B, bctx);
  b.push("MATCH_START"); b.push("FIRST_SERVE", { side: "a" });
  b.push("RALLY_WON", { winner: "b", how: "smash_winner" });
  assert.equal(B.answerQuestion(b.env.sport, bctx, b.rules, "Why did the score change?").answer, "Bravo scored because Bravo won the rally (a smash winner). It is 0-1 in game 1.");
  assert.match(B.answerQuestion(b.env.sport, bctx, b.rules, "How many points to win a game?").answer, /first side to 21 points with a 2-point lead; if it reaches 29-all, the first to 30 wins/);
  assert.match(B.answerQuestion(b.env.sport, bctx, b.rules, "Who has the most smash winners?").answer, /lead(s)? with 1 smash winners/);

  const pctx = makeContext("pickleball", 2);
  const p = openMatch(P, pctx);
  p.push("MATCH_START"); p.push("FIRST_SERVE", { side: "a" });
  p.push("RALLY_WON", { winner: "a" });
  p.push("RALLY_WON", { winner: "b", how: "unforced_error" });
  const ask = asker(P, p);
  assert.match(ask("Why didn't the score change?").answer, /^Bravo won the rally \(an unforced error\) but did not score: only the serving side scores/);
  assert.match(ask("What is a side out?").answer, /only the serving side can score/);
  assert.match(ask("What is the kitchen?").answer, /^Kitchen: /);
  const rally = openMatch(P, pctx, { scoring: "rally" });
  assert.match(P.answerQuestion(rally.env.sport, pctx, rally.rules, "How many points to win a game?").answer, /Rally scoring: every rally scores/);
});

section("game iq: swimming answers who won, times and disqualifications", () => {
  const ctx = { sport: "swimming", sides: null };
  const entry = (lane, name) => ({ lane, entryId: `team-${lane}`, name, teamId: `team-${lane}`, teamPlayerId: `tp-${lane}`, userId: `user-${lane}` });
  const m = openMatch(S, ctx, { distance: 100, stroke: "freestyle", course: 50, round: "heat", heat: 1, entries: [entry(3, "Asha"), entry(4, "Bina"), entry(5, "Chand")] });
  m.push("MATCH_START"); m.push("RACE_START");
  m.push("REACTION", { lane: 4, timeMs: 650 });
  m.push("RACE_FINISH", { lane: 4, timeMs: parseDuration("52.34") });
  m.push("RACE_FINISH", { lane: 3, timeMs: parseDuration("53.10") });
  m.push("DISQUALIFICATION", { lane: 5, reason: "Illegal turn" });
  const ask = asker(S, m);
  assert.equal(ask("Who won?").answer, "Bina (lane 4) won in 52.34.");
  assert.equal(ask("Why was Chand disqualified?").answer, "Chand was disqualified: Illegal turn.");
  assert.equal(ask("What time did Asha swim?").answer, "Asha: 53.10 final time.");
  assert.match(ask("What is the false start rule?").answer, /One-start rule/);
  assert.match(ask("What is a split?").answer, /^Split: /);
});
