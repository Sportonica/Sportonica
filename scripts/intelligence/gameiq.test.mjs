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
  assert.equal(ask("How many wickets has Bravo 1 taken?").answer, "Bravo 1: 1 wicket.");
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
  assert.equal(ask("Who has the most kills?").answer, "Alpha 3 and Bravo 4 lead with 1 kill.");
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
  assert.match(B.answerQuestion(b.env.sport, bctx, b.rules, "Who has the most smash winners?").answer, /lead(s)? with 1 smash winner\./);

  const pctx = makeContext("pickleball", 2);
  const p = openMatch(P, pctx);
  p.push("MATCH_START"); p.push("FIRST_SERVE", { side: "a" });
  p.push("RALLY_WON", { winner: "a" });
  p.push("RALLY_WON", { winner: "b", how: "unforced_error" });
  const ask = asker(P, p);
  assert.match(ask("Why didn't the score change?").answer, /^Bravo won the rally \(an unforced error\) but did not score: only the serving side scores/);
  assert.match(ask("What is a side out?").answer, /^Side out: The serve passes to the other team/, "a definition question gets the definition");
  assert.match(ask("Can the receiving team score?").answer, /only the serving side can score/, "a rules question gets this competition's rule");
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

section("game iq: insights for the rally sports, from the recorded rallies", () => {
  const vctx = makeContext("volleyball", 6);
  const v = openMatch(V, vctx, { bestOf: 1 });
  v.push("MATCH_START"); v.push("FIRST_SERVE", { side: "a" });
  for (let i = 0; i < 10; i++) v.push("RALLY_WON", { winner: "a" });          // 10-0 to Alpha
  for (let i = 0; i < 25; i++) v.push("RALLY_WON", { winner: "b", how: "kill" }); // then 25 straight to Bravo
  const vi = V.insights(v.env.sport, vctx, v.rules);
  assert.equal(vi[0], "Bravo won 1-0 in sets (25-10).", "read from the winner's side");
  assert.ok(vi.includes("Bravo won 25 rallies in a row in set 1."));
  assert.ok(vi.includes("Bravo came back from 10 points down to win set 1."));
  assert.ok(vi.includes("Bravo had more kills: 25 to 0."));

  const bctx = makeContext("badminton", 1);
  const b = openMatch(B, bctx);
  b.push("MATCH_START"); b.push("FIRST_SERVE", { side: "a" });
  for (let i = 0; i < 12; i++) b.push("RALLY_WON", { winner: i % 2 ? "a" : "b" });
  const bi = B.insights(b.env.sport, bctx, b.rules);
  assert.equal(bi[0], "Level at 0-0 in games; 6-6 in game 1.");
  assert.deepEqual(B.insights(openMatch(B, bctx).env.sport, bctx, b.rules), [], "nothing before the first rally");
});

section("game iq: cricket insights: the chase, top scorer, expensive over", () => {
  const ctx = makeContext("cricket", 11);
  const m = openMatch(C, ctx, { preset: "t20", oversPerInnings: 2 });
  m.push("MATCH_START"); m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  for (const runs of [6, 6, 4, 0, 6, 2]) m.push("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: runs });
  for (let i = 0; i < 6; i++) m.push("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b2", runsBat: 0 });
  const ins = C.insights(m.env.sport, ctx, m.rules);
  assert.equal(ins[0], "Alpha made 24/0 in 2.0 overs. Bravo need 25 to win from 2 overs (12.50 an over).");
  assert.ok(ins.includes("Alpha 1 top-scored for Alpha with 24* off 12 balls."));
  assert.ok(ins.includes("Over 1 of Alpha's innings went for 24 (6 6 4 0 6 2)."));
});

section("game iq: swimming insights: close finish, negative split, disqualification", () => {
  const ctx = { sport: "swimming", sides: null };
  const entry = (lane, name) => ({ lane, entryId: `t${lane}`, name, teamId: `t${lane}` });
  const m = openMatch(S, ctx, { distance: 100, stroke: "freestyle", course: 50, round: "final", heat: 1, entries: [entry(3, "Asha"), entry(4, "Bina"), entry(5, "Chand")] });
  m.push("MATCH_START"); m.push("RACE_START");
  m.push("REACTION", { lane: 4, timeMs: 640 });
  m.push("SPLIT", { lane: 4, distance: 50, timeMs: 26800 });
  m.push("RACE_FINISH", { lane: 4, timeMs: 53100 });
  m.push("RACE_FINISH", { lane: 3, timeMs: 53160 });
  m.push("DISQUALIFICATION", { lane: 5, reason: "Illegal turn" });
  assert.deepEqual(S.insights(m.env.sport, ctx, m.rules), [
    "Bina won in 53.10.",
    "A close finish: Asha was 0.06 behind.",
    "Bina swam a negative split: 26.80 then 26.30.",
    "Fastest reaction off the blocks: Bina (0.64).",
    "Chand was disqualified: Illegal turn.",
  ]);
});
