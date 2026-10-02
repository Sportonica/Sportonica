import assert from "node:assert/strict";
import { footballEngine as E } from "../../src/lib/intelligence/sports/football.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { makeContext, openMatch, section, cell } from "./harness.mjs";

const ctx = makeContext("football", 9);
const kick = (rules = {}) => { const m = openMatch(E, ctx, rules); m.push("MATCH_START"); m.push("PERIOD_START"); return m; };
const toFullTime = (m) => { m.push("PERIOD_END"); m.push("PERIOD_START"); m.push("PERIOD_END"); };
const ask = (m, q) => E.answerQuestion(m.env.sport, ctx, m.rules, q).answer;

section("football: goals, assists and shots, each its own event", () => {
  const m = kick();
  m.refuses("GOAL", { side: "a", player: "b1" }, /not in Alpha/, "a goal by the other team's player");
  m.push("SHOT", { side: "a", player: "a1", outcome: "off_target", minute: 3 });
  m.push("SHOT", { side: "a", player: "a1", outcome: "on_target", keeper: "b1", minute: 5 });
  m.push("GOAL", { side: "a", player: "a1", assist: "a2", minute: 7 });
  m.push("GOAL", { side: "b", player: "b3", kind: "header", minute: 12 });
  assert.deepEqual(m.env.sport.score, { a: 1, b: 1 });
  const p = m.stats().players;
  assert.equal(cell(p, "players", "a1", "goals"), 1);
  assert.equal(cell(p, "players", "a1", "shots"), 3, "a goal is also a shot on target");
  assert.equal(cell(p, "players", "a1", "shotsOnTarget"), 2);
  assert.equal(cell(p, "players", "a2", "assists"), 1);
  assert.equal(cell(p, "players", "b1", "saves"), 1, "an on-target shot that is not a goal is a save");
  const t = m.stats().teams;
  assert.equal(cell(t, "team", "a", "conversion"), 33.3, "1 goal from 3 shots");
  assert.equal(cell(t, "team", "a", "shotAccuracy"), 66.7);
  m.refuses("GOAL", { side: "a", player: "a1", assist: "a1" }, /own goal/, "assisting yourself");
  m.refuses("SHOT", { side: "a", player: "a1", outcome: "into_orbit" }, /on target, off target/, "a made-up shot outcome");
  assert.equal(E.answerQuestion(m.env.sport, ctx, m.rules, "Why did the score change?").answer, "Bravo's score went from 0 to 1 because of a goal by Bravo 3 (header) (12'). It is 1-1.");
  m.assertReconstructs("goals");
});

section("football: an own goal counts for the other team and credits no scorer", () => {
  const m = kick();
  m.push("GOAL", { side: "a", ownGoal: true, player: "b4", minute: 20 });
  assert.deepEqual(m.env.sport.score, { a: 1, b: 0 });
  assert.equal(m.env.sport.players.b4.ownGoals, 1);
  assert.equal(m.env.sport.players.b4.goals ?? 0, 0);
  m.refuses("GOAL", { side: "a", ownGoal: true, player: "a1" }, /must be in Bravo/, "an own goal by your own player");
  m.refuses("GOAL", { side: "a", ownGoal: true, player: "b4", assist: "a2" }, /no assist/, "an assist on an own goal");
});

section("football: cards, sendings-off and the minimum number of players", () => {
  const five = makeContext("football", 8);
  const m = openMatch(E, five, { preset: "futsal" });
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  m.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
  m.push("PERIOD_START");
  m.push("CARD", { side: "a", player: "a2", color: "yellow", minute: 4 });
  assert.equal(m.env.sport.sentOff.a2, undefined);
  m.push("CARD", { side: "a", player: "a2", color: "yellow", minute: 9 });
  assert.equal(m.env.sport.sentOff.a2, true, "two yellows");
  assert.deepEqual(m.env.sport.onPitch.a, ["a1", "a3", "a4", "a5"]);
  assert.equal(m.env.sport.players.a2.redCards, 1);
  m.refuses("SHOT", { side: "a", player: "a2", outcome: "off_target" }, /sent off/, "a sent-off player shooting");
  m.refuses("SUBSTITUTION", { side: "a", in: "a2", out: "a1" }, /cannot come back/, "bringing a sent-off player back");
  m.push("CARD", { side: "a", player: "a3", color: "red" });
  m.push("CARD", { side: "a", player: "a4", color: "red" });
  assert.ok(E.derivedLog(m.env.sport).some((l) => /below 3 players/.test(l.text)), "futsal needs 3 to play on");
  assert.match(m.summary().view.notes.join(" "), /Sent off: Alpha 2, Alpha 3, Alpha 4/);
});

section("football: futsal accumulated fouls give a second-penalty-mark kick", () => {
  const m = kick({ preset: "futsal" });
  for (let i = 0; i < 5; i++) m.push("FOUL", { side: "b", player: `b${i + 1}`, on: "a1" });
  assert.equal(E.derivedLog(m.env.sport).some((l) => /second penalty mark/.test(l.text)), false, "5 fouls: no penalty yet");
  m.push("FOUL", { side: "b", player: "b6", on: "a2" });
  assert.ok(E.derivedLog(m.env.sport).some((l) => /6th accumulated foul: a direct kick from the second penalty mark/.test(l.text)));
  assert.equal(m.env.sport.players.a1.foulsDrawn, 5);
  m.push("PERIOD_END"); m.push("PERIOD_START");
  const facts = Object.fromEntries(m.summary().view.facts.map((f) => [f.label, f]));
  assert.equal(facts["Fouls this half"].b, "0", "the count starts again in the second half");
});

section("football: a league match can end level; a knockout cannot", () => {
  const league = kick();
  league.push("GOAL", { side: "a", player: "a1" }); league.push("GOAL", { side: "b", player: "b1" });
  toFullTime(league);
  league.refuses("PERIOD_START", {}, /Full time: complete the match/, "extra time in a league match");
  league.push("MATCH_COMPLETE");
  assert.deepEqual(league.env.result, { outcome: "draw", winner: null, method: "played", margin: "1-1" });

  const ko = kick({ knockout: true, preset: "futsal" });
  ko.push("GOAL", { side: "a", player: "a1" }); ko.push("GOAL", { side: "b", player: "b1" });
  toFullTime(ko);
  ko.refuses("MATCH_COMPLETE", {}, /cannot end level: play extra time/, "a knockout match ending level");
  ko.refuses("SHOOTOUT_START", { first: "a" }, /Play extra time first/, "penalties before extra time");
  ko.push("PERIOD_START"); ko.push("GOAL", { side: "b", player: "b2", minute: 44 }); ko.push("PERIOD_END");
  ko.push("PERIOD_START"); ko.push("PERIOD_END");
  ko.push("MATCH_COMPLETE");
  assert.deepEqual(ko.env.result, { outcome: "win", winner: "b", method: "played", margin: "2-1 a.e.t." });
  assert.deepEqual(E.mirrorScore(ko.env.sport, ctx, ko.rules).football, { regularA: 1, regularB: 1, extraA: 0, extraB: 1, pensA: null, pensB: null }, "the fixture keeps regular time and extra time apart");
  ko.assertReconstructs("extra time");
});

section("football: penalty shootout, in turn, decided as soon as it cannot be caught", () => {
  const m = kick({ preset: "sevens", knockout: true });
  toFullTime(m);
  m.refuses("PERIOD_START", {}, /penalty shootout/, "extra time in sevens (straight to penalties)");
  m.push("SHOOTOUT_START", { first: "a" });
  m.refuses("SHOOTOUT_KICK", { side: "b", scored: true }, /Alpha's kick/, "kicking out of turn");
  for (let i = 0; i < 2; i++) { m.push("SHOOTOUT_KICK", { side: "a", scored: true }); m.push("SHOOTOUT_KICK", { side: "b", scored: false }); }
  m.push("SHOOTOUT_KICK", { side: "a", scored: true });
  assert.equal(m.env.sport.shootout.decided, null, "3-0 with three Bravo kicks left: they could still level");
  m.push("SHOOTOUT_KICK", { side: "b", scored: false });
  assert.equal(m.env.sport.shootout.decided, "a", "3-0 with two Bravo kicks left: decided");
  m.refuses("SHOOTOUT_KICK", { side: "a", scored: true }, /decided/, "a kick after it is decided");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "0-0, 3-0 on penalties");
  assert.deepEqual(E.mirrorScore(m.env.sport, ctx, m.rules).football, { regularA: 0, regularB: 0, extraA: null, extraB: null, pensA: 3, pensB: 0 });

  const sd = kick({ preset: "sevens", knockout: true });
  toFullTime(sd);
  sd.push("SHOOTOUT_START", { first: "b" });
  for (let i = 0; i < 5; i++) { sd.push("SHOOTOUT_KICK", { side: "b", scored: true }); sd.push("SHOOTOUT_KICK", { side: "a", scored: true }); }
  assert.equal(sd.env.sport.shootout.decided, null, "5-5: sudden death");
  sd.push("SHOOTOUT_KICK", { side: "b", scored: false });
  assert.equal(sd.env.sport.shootout.decided, null, "Bravo miss, Alpha still to kick");
  sd.push("SHOOTOUT_KICK", { side: "a", scored: true });
  assert.equal(sd.env.sport.shootout.decided, "a");
});

section("football: substitutions follow the competition", () => {
  const eleven = makeContext("football", 16);
  const m = openMatch(E, eleven, { preset: "eleven" });
  m.push("MATCH_START");
  const xi = (side) => Array.from({ length: 11 }, (_, i) => `${side}${i + 1}`);
  m.push("LINEUP", { side: "a", players: xi("a") });
  m.push("LINEUP", { side: "b", players: xi("b") });
  m.push("PERIOD_START");
  for (let i = 0; i < 5; i++) m.push("SUBSTITUTION", { side: "a", in: `a${12 + i}`, out: `a${i + 1}`, minute: 50 + i });
  m.refuses("SUBSTITUTION", { side: "a", in: "a1", out: "a6" }, /used all 5 substitutions/, "a sixth substitution");
  m.push("SUBSTITUTION", { side: "b", in: "b12", out: "b1", minute: 60 });           // Bravo still have all theirs
  m.refuses("SUBSTITUTION", { side: "b", in: "b1", out: "b2" }, /cannot return/, "no rolling substitutions in eleven-a-side");
  const futsal = openMatch(E, makeContext("football", 9), { preset: "futsal" });
  futsal.push("MATCH_START");
  futsal.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  futsal.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
  futsal.push("PERIOD_START");
  futsal.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1", minute: 5 });
  futsal.push("SUBSTITUTION", { side: "a", in: "a1", out: "a6", minute: 10 });
  assert.ok(futsal.env.sport.onPitch.a.includes("a1"), "rolling substitutions: a player can come back");
  futsal.push("PERIOD_END");
  assert.equal(cell(futsal.stats().players, "players", "a1", "min"), 15, "minutes: 0-5 and 10-20");
  assert.equal(cell(futsal.stats().players, "players", "a6", "min"), 5);
});

section("football: possession and pass accuracy only from recorded passes", () => {
  const m = kick();
  assert.equal(cell(m.stats().teams, "team", "a", "possession"), null, "no passes recorded: no possession figure");
  for (let i = 0; i < 6; i++) m.push("PASS", { side: "a", player: "a1", completed: i < 5 });
  for (let i = 0; i < 4; i++) m.push("PASS", { side: "b", player: "b1", completed: true });
  const t = m.stats().teams;
  assert.equal(cell(t, "team", "a", "possession"), 60);
  assert.equal(cell(t, "team", "a", "passAccuracy"), 83.3);
  assert.equal(cell(t, "team", "a", "passes"), "5/6");
  m.refuses("PASS", { side: "a", player: "a1", completed: false, to: "a2" }, /no receiver/, "an incomplete pass to someone");
});

section("football: timeouts are a futsal rule", () => {
  const futsal = kick({ preset: "futsal" });
  futsal.push("TIMEOUT", { side: "a" });
  futsal.refuses("TIMEOUT", { side: "a" }, /used their timeout/, "a second timeout in the half");
  const eleven = kick({ preset: "eleven" });
  eleven.refuses("TIMEOUT", { side: "a" }, /no timeouts/, "a timeout in eleven-a-side");
});

section("football: Game IQ from the match and the competition's rules", () => {
  const m = kick({ preset: "futsal", knockout: true });
  m.push("GOAL", { side: "a", player: "a1", minute: 7 });
  m.push("SHOT", { side: "b", player: "b2", outcome: "on_target", minute: 9 });
  assert.match(ask(m, "What is the score?"), /^Alpha 1, Bravo 0/);
  assert.equal(ask(m, "Who has the most goals?"), "1 Alpha 1 leads with 1 goals.");
  assert.equal(ask(m, "Why didn't the score change?"), "No goal: Bravo 2's shot was saved (9'). The score stays 1-0.");
  assert.match(ask(m, "How many shots on target?"), /Alpha: 1 shots on target; Bravo: 1 shots on target/);
  assert.match(ask(m, "What happens if it is a draw?"), /5-minute halves of extra time, then a penalty shootout/);
  assert.match(ask(m, "Is there offside?"), /no offside/);
  assert.match(ask(m, "What are accumulated fouls?"), /6th foul/);
  assert.match(ask(m, "What is xG?"), /does not calculate it/);
  assert.ok(E.rulesGuide(m.rules).some((g) => g.title === "If it is level"));
});

section("football: a corrected goal recalculates the score, scorer and fixture", () => {
  const m = kick();
  const g = m.push("GOAL", { side: "a", player: "a1", assist: "a2" });
  m.push("GOAL", { side: "b", player: "b1" });
  m.correct("void", g.id, "Disallowed: offside");
  assert.deepEqual(m.env.sport.score, { a: 0, b: 1 });
  assert.equal(m.env.sport.players.a1?.goals ?? 0, 0);
  assert.equal(m.env.sport.players.a2?.assists ?? 0, 0);
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  m.assertReconstructs("corrected goal");
});

section("football: season totals and presets", () => {
  const g1 = kick(); g1.push("GOAL", { side: "a", player: "a1" }); g1.push("SHOT", { side: "a", player: "a1", outcome: "off_target" });
  const g2 = kick(); g2.push("GOAL", { side: "a", player: "a1" }); g2.push("GOAL", { side: "a", player: "a1" });
  const lines = [g1, g2].map((g) => g.stats().lines.find((l) => l.subject === "player" && l.subjectKey === "a1").raw);
  const agg = aggregate(E, "player", lines);
  assert.equal(agg.values.goals, 3);
  assert.equal(agg.values.goalsPerMatch, 1.5);
  assert.equal(agg.values.conversion, 75, "3 goals from 4 shots across both games");
  assert.deepEqual([E.resolveRules({}).preset, E.resolveRules({}).playersOnPitch, E.resolveRules({ preset: "eleven" }).periodMinutes, E.resolveRules({ preset: "sevens" }).knockoutDecider], ["futsal", 5, 45, "penalties"]);
  assert.throws(() => E.resolveRules({ preset: "beach" }), RulesError);
  assert.throws(() => E.resolveRules({ minPlayers: 9 }), RulesError);
});
