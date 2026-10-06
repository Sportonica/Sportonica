import assert from "node:assert/strict";
import { basketballEngine as E, leadStats, scoringRunsOf, possessions, bonusFor, timeoutsLeft, comebacks, benchOf, eligibleOf, substitutionsLeft } from "../../src/lib/intelligence/sports/basketball.ts";
import { breakAfter } from "../../src/lib/intelligence/sports/basketball/rules.ts";
import { clockReadings, clockText, parseClock, shotClockAfter } from "../../src/lib/intelligence/sports/basketball/clock.ts";
import { checkBoxScoreSave } from "../../src/lib/intelligence/boxScorePlan.ts";
import { GLOSSARY } from "../../src/lib/intelligence/sports/basketball/knowledge.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { reconstruct, effectiveEvents } from "../../src/lib/intelligence/core/engine.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { makeContext, openMatch, section, cell, card } from "./harness.mjs";

const ctx = makeContext("basketball", 6);
const made = (side, player, points, extra = {}) => ["SHOT_MADE", { side, player, points, ...extra }];
const table = (an, key) => an.tables.find((t) => t.key === key);
const row = (an, key, id) => table(an, key)?.rows.find((r) => r.id === id);
const lineups = (m) => {
  m.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  m.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
};
const periods = (m, n) => { for (let i = 0; i < n; i++) { m.push("PERIOD_START"); m.push("PERIOD_END"); } };

// Q1 5-4, Q2 0-4, Q3 6-0, Q4 0-3: 11-11 after regulation
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
  m.push(...made("b", "b2", 2));
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

// A realistic first quarter for possession counting (Alpha 5, Bravo 11).
function possessionGame() {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push("JUMP_BALL", { side: "a" });
  m.push("SHOT_MISSED", { side: "a", player: "a1", points: 2 });
  m.push("REBOUND", { side: "a", player: "a2", offensive: true });
  m.push(...made("a", "a2", 2));                                  // second chance
  m.push("SHOT_MISSED", { side: "b", player: "b1", points: 3 });
  m.push("REBOUND", { side: "a", player: "a3", offensive: false });
  m.push("TURNOVER", { side: "a", player: "a3" });
  m.push("STEAL", { side: "b", player: "b2" });
  m.push(...made("b", "b2", 2, { fastBreak: true }));              // off the turnover
  m.push(...made("a", "a1", 2));
  m.push("FOUL", { side: "b", player: "b3", kind: "shooting", on: "a1", freeThrows: 1 });
  m.push("FREE_THROW_MADE", { side: "a", player: "a1" });          // and-one: same possession
  m.push(...made("b", "b1", 2));
  m.push("TURNOVER", { side: "a", player: "a4" });
  m.push(...made("b", "b1", 3));                                   // off the turnover
  m.push(...made("b", "b2", 2));                                   // Alpha's possession in between was not recorded
  m.push("STEAL", { side: "b", player: "b3" });                    // ... nor this one, which ended in the steal
  m.push(...made("b", "b3", 2));
  m.push("PERIOD_END");
  return m;
}

// ── scoring ──────────────────────────────────────────────────────────

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
  assert.deepEqual(m.env.sport.scoring.map((e) => [e.a, e.b]), [[1, 0], [3, 0], [6, 0]], "every score change is +1, +2 or +3 from the previous");
});

section("basketball: FT 1/2 is 2 attempts, 1 made, 1 point, 50%", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push("FREE_THROW_MADE", { side: "b", player: "b1" });
  m.push("FREE_THROW_MISSED", { side: "b", player: "b1" });
  const box = m.stats().players;
  assert.equal(cell(box, "box", "b1", "fta"), 2);
  assert.equal(cell(box, "box", "b1", "ftm"), 1);
  assert.equal(cell(box, "box", "b1", "pts"), 1);
  assert.equal(cell(box, "box", "b1", "ftPct"), 50);
  assert.equal(cell(box, "box", "b1", "ft"), "1-2");
});

// ── game flow ───────────────────────────────────────────────────────

section("basketball: Q1 to Q4 to overtime, score by period", () => {
  const m = fullGame();
  assert.deepEqual(m.env.sport.score, { a: 11, b: 11 });
  assert.equal(m.summary().view.brief, "5-4, 0-4, 6-0, 0-3", "a card shows the score quarter by quarter");
  assert.equal(m.summary().view.periodLabel, "End of regulation");
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

section("basketball: halftime, multiple overtimes, and a score never completes a game by itself", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  periods(m, 2);
  assert.equal(m.summary().view.periodLabel, "Halftime");
  periods(m, 2);
  m.push("PERIOD_START"); m.push(...made("a", "a1", 2)); m.push(...made("b", "b1", 2)); m.push("PERIOD_END");
  assert.equal(m.env.status, "live", "a level score after OT1 does not end the game");
  m.push("PERIOD_START");
  assert.equal(m.summary().view.periodLabel.startsWith("OT2"), true);
  m.push(...made("a", "a1", 2)); m.push("PERIOD_END");
  assert.equal(m.env.status, "live", "the game is only final when the scorer completes it");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "4-2, OT2");
  m.assertReconstructs("double overtime");
});

section("basketball: overtime only when level", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  for (let q = 1; q <= 4; q++) { m.push("PERIOD_START"); if (q === 1) m.push(...made("a", "a1", 2)); m.push("PERIOD_END"); }
  m.refuses("PERIOD_START", {}, /only played when the score is level/, "OT at 2-0");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2 }, /Start the period/, "scoring between periods");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "2-0");
});

section("basketball: a tie is allowed only when the format says so", () => {
  const m = openMatch(E, ctx, { allowTie: true });
  m.push("MATCH_START");
  periods(m, 4);
  m.refuses("PERIOD_START", {}, /allows a tie/, "no overtime when ties stand");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.outcome, "tie");
});

// ── competition configuration ──────────────────────────────────────

section("basketball: presets and configurable formats (FIBA, NBA, NCAA, 3x3, custom)", () => {
  const fiba = E.resolveRules({});
  assert.equal(fiba.preset, "fiba");
  assert.deepEqual([fiba.periods, fiba.periodMinutes, fiba.foulLimit, fiba.shotClockSeconds], [4, 10, 5, 24]);
  const nba = E.resolveRules({ preset: "nba" });
  assert.deepEqual([nba.periodMinutes, nba.foulLimit, nba.timeoutsPerGame, nba.offensiveFoulsAreTeamFouls, nba.alternatingPossession], [12, 6, 7, false, false]);
  const ncaa = E.resolveRules({ preset: "ncaa" });
  assert.deepEqual([ncaa.periods, ncaa.periodMinutes, ncaa.teamFoulWindow, ncaa.doubleBonusAfterFouls, ncaa.shotClockSeconds], [2, 20, "half", 9, 30]);
  assert.equal(E.resolveRules({ preset: "nba", foulLimit: 5 }).foulLimit, 5, "a preset is a starting point, not a lock");

  const nbaGame = openMatch(E, ctx, { preset: "nba" });
  nbaGame.push("MATCH_START"); nbaGame.push("PERIOD_START");
  assert.equal(nbaGame.env.sport.clock, 720);
  const x3 = openMatch(E, ctx, { twoPointValue: 1, threePointValue: 2, periods: 1, playersOnCourt: 3 });
  x3.push("MATCH_START"); x3.push("PERIOD_START");
  x3.push(...made("a", "a1", 2));
  assert.equal(x3.env.sport.team.a.tpm, 1, "in 3x3 the 2 is the shot from outside the arc");
  x3.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3 }, /worth 1 or 2/, "3 in 3x3");

  assert.throws(() => E.resolveRules({ periods: 0 }), RulesError);
  assert.throws(() => E.resolveRules({ twoPointValue: 3 }), RulesError);
  assert.throws(() => E.resolveRules({ preset: "euroleague" }), RulesError);
  assert.throws(() => E.resolveRules({ doubleBonusAfterFouls: 3 }), RulesError, "double bonus before the bonus");
  assert.throws(() => E.resolveRules({ standingsWinPoints: 1, standingsLossPoints: 1 }), RulesError);
  assert.throws(() => E.resolveRules({ teamFoulWindow: "quarter" }), RulesError);
  assert.throws(() => E.resolveRules({ clutchMinutes: 11 }), RulesError);
  assert.deepEqual(E.ruleChoices.preset, ["fiba", "nba", "ncaa", "custom"]);
});

section("basketball: shot clock values come from the competition", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const ev = m.push("SHOT_MADE", { side: "a", player: "a1", points: 2, shotClock: 10, clock: 300 });
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, shotClock: 30 }, /0 to 24/, "longer than the FIBA shot clock");
  const before = structuredClone(m.env.sport); before.clock = 600;
  assert.equal(E.eventLabel(before, ev, m.rules), "Q1 05:00, shot clock 10", "play-by-play shows the period, game clock and shot clock");
  const none = openMatch(E, ctx, { shotClockSeconds: null });
  none.push("MATCH_START"); none.push("PERIOD_START");
  none.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, shotClock: 10 }, /without a shot clock/, "no shot clock in this competition");
});

// ── statistics ─────────────────────────────────────────────────────

section("basketball: player statistics and derived percentages", () => {
  const m = fullGame();
  const box = m.stats().players;
  assert.deepEqual(box.map((t) => t.key), ["box", "shooting", "advanced", "fouls"]);
  assert.deepEqual(box[0].columns.map((c) => c.label), ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "3P", "FT", "+/-", "PF"]);
  assert.equal(cell(box, "box", "a1", "pts"), 2);
  assert.equal(cell(box, "box", "a1", "fg"), "1-2");
  assert.equal(cell(box, "box", "a1", "fgPct"), 50);
  assert.equal(cell(box, "box", "a1", "ast"), 1);
  assert.equal(cell(box, "box", "a1", "tov"), 1);
  assert.equal(cell(box, "box", "a1", "astTov"), 1);
  assert.equal(cell(box, "box", "a2", "pts"), 9);
  assert.equal(cell(box, "box", "a2", "tpPct"), 100);
  assert.equal(cell(box, "box", "a2", "efgPct"), 150);
  assert.equal(cell(box, "box", "b1", "pts"), 7);
  assert.equal(cell(box, "box", "b1", "ftPct"), 50);
  assert.equal(cell(box, "box", "b2", "dreb"), 1);
  assert.equal(cell(box, "box", "b2", "reb"), 1);
  assert.equal(cell(box, "box", "b3", "stl"), 1);
  assert.equal(cell(box, "box", "a2", "eff"), 9, "efficiency: 9 points, nothing missed");
  assert.equal(cell(box, "box", "a1", "eff"), 1, "2 PTS + 1 AST - 1 missed FG - 1 TOV");
  // no attempts: a percentage does not exist, it is not 0%
  assert.equal(cell(box, "box", "a3", "fgPct"), null);
  assert.equal(cell(box, "box", "a2", "ftPct"), null);
  assert.equal(cell(box, "box", "a2", "astTov"), null, "no turnovers: the ratio is undefined");
  assert.equal(cell(box, "box", "a1", "usgPct"), null, "no lineups or clock: usage is not calculated");
});

section("basketball: team statistics and possession-based efficiency", () => {
  const m = fullGame();
  const t = m.stats().teams;
  assert.deepEqual(t.map((x) => x.key), ["team", "teamAdvanced", "teamFouls"]);
  assert.equal(cell(t, "team", "a", "pts"), 11);
  assert.equal(cell(t, "team", "a", "paintPts"), 2);
  assert.equal(cell(t, "team", "b", "fastBreakPts"), 2);
  assert.equal(cell(t, "team", "b", "secondChancePts"), 0, "second chances come from offensive rebounds, and there were none");
  assert.equal(cell(t, "team", "a", "fgPct"), 80);           // 4 of 5
  assert.equal(cell(t, "team", "a", "efgPct"), 110);         // (4 + 0.5*3) / 5
  assert.equal(cell(t, "team", "a", "possessions"), 7, "counted from play-by-play, including the rule-inferred ones");
  assert.equal(cell(t, "team", "b", "possessions"), 8);
  assert.equal(cell(t, "team", "a", "possEst"), 6);          // 5 FGA + 0 FTA - 0 ORB + 1 TOV, shown for comparison
  assert.equal(possessions(m.env.sport.team.b), 4 + 0.44 * 2);
  assert.equal(cell(t, "team", "a", "offRating"), 157.1);    // 100 * 11 / 7
  assert.equal(cell(t, "team", "a", "defRating"), 137.5);    // 100 * 11 / 8
  assert.equal(cell(t, "team", "a", "netRating"), 19.6);
  assert.equal(cell(t, "team", "a", "ppp"), 1.57);
  assert.equal(cell(t, "team", "a", "tovRate"), 14.3);
  assert.equal(cell(t, "team", "a", "pace"), 7.5, "possessions per 40 minutes, both teams averaged");
  assert.equal(cell(t, "team", "a", "ptsPerPeriod"), 2.8);
  assert.equal(cell(t, "team", "a", "benchPts"), null, "no starters were recorded");
  assert.equal(cell(t, "team", "a", "orebPct"), 0);          // 0 / (0 + 1 opponent DREB)
  assert.equal(cell(t, "team", "b", "orebPct"), null, "no rebounds at that end: undefined, not 0");
  assert.equal(cell(t, "team", "a", "oppFgPct"), 100);       // Bravo 4 of 4 (their only miss was a free throw)
  assert.equal(cell(t, "team", "a", "largestLead"), 5);
});

section("basketball: possessions follow the play-by-play", () => {
  const m = possessionGame();
  const s = m.env.sport;
  assert.deepEqual(s.score, { a: 5, b: 11 });
  const by = (side) => s.possessions.filter((p) => p.side === side);
  assert.equal(by("a").length, 6);
  assert.equal(by("b").length, 6);
  assert.equal(s.possessions.filter((p) => p.inferred).length, 2, "two Alpha possessions are certain from the rules but had no event");
  assert.equal(by("a")[0].start, "jump_ball");
  assert.equal(by("a")[0].oreb, 1, "the offensive rebound continued the same possession");
  assert.equal(by("a")[0].points, 2);
  assert.equal(by("a")[2].points, 3, "the and-one free throw belongs to the same possession");
  assert.deepEqual(by("a").map((p) => p.result), ["score", "turnover", "score", "turnover", "other", "turnover"]);
  assert.deepEqual(by("b").map((p) => p.result), ["miss", "score", "score", "score", "score", "score"]);
  assert.equal(by("a").reduce((t, p) => t + p.points, 0), s.score.a, "possession points add up to the score");
  assert.equal(by("b").reduce((t, p) => t + p.points, 0), s.score.b);
  const t = m.stats().teams;
  assert.equal(cell(t, "team", "a", "secondChancePts"), 2);
  assert.equal(cell(t, "team", "b", "ptsOffTov"), 7, "2 after the steal, 3 after the bad inbound, 2 after the second steal");
  assert.equal(cell(t, "team", "b", "fastBreakPts"), 2);
  assert.equal(cell(t, "team", "a", "ppp"), 0.83);
  assert.equal(cell(t, "team", "b", "ppp"), 1.83);
  assert.equal(s.ball, null, "nobody has the ball between periods");
  assert.equal(s.arrow, "b", "the team that lost the opening jump gets the arrow");
  const an = m.analytics();
  assert.deepEqual(row(an, "possessions", "score").values, { n_a: 2, pts_a: 5, n_b: 5, pts_b: 11 });
  assert.equal(row(an, "possessions", "turnover").values.n_a, 3);
  assert.match(card(an, "Possessions"), /Alpha 6, Bravo 6/);
  assert.deepEqual(E.validateScore(s, ctx, m.rules), []);
  m.assertReconstructs("possessions");
});

section("basketball: who has the ball, jump balls and the possession arrow", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.refuses("HELD_BALL", {}, /arrow is not set/, "held ball before the opening jump");
  m.push("JUMP_BALL", { side: "b" });
  assert.equal(m.summary().view.possession, "b");
  m.push(...made("b", "b1", 2));
  assert.equal(m.summary().view.possession, "a", "after a basket the other team inbounds");
  m.push("HELD_BALL");
  assert.equal(m.env.sport.ball, "a", "the arrow pointed to Alpha");
  assert.equal(m.env.sport.arrow, "b", "and then flips");
  m.push("ARROW", { side: "a" });
  assert.equal(m.env.sport.arrow, "a");
  const nba = openMatch(E, ctx, { preset: "nba" });
  nba.push("MATCH_START"); nba.push("PERIOD_START"); nba.push("JUMP_BALL", { side: "a" });
  nba.refuses("HELD_BALL", {}, /jump ball/, "the NBA has no arrow");
  nba.refuses("ARROW", { side: "a" }, /no possession arrow/, "no arrow to set");
});

// ── fouls ──────────────────────────────────────────────────────────

section("basketball: foul types, fouls drawn and free throws awarded", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push("FOUL", { side: "a", player: "a1", kind: "shooting", on: "b2", freeThrows: 2 });
  m.push("FOUL", { side: "b", player: "b1", kind: "offensive" });
  m.push("FOUL", { side: "a", kind: "technical" });              // bench / coach
  m.push("FOUL", { side: "a", player: "a2" });                   // personal, free throws not stated
  const s = m.env.sport;
  assert.equal(s.players.a1.foulsShooting, 1);
  assert.equal(s.players.b2.pfd, 1, "the fouled player is credited with a foul drawn");
  assert.equal(s.players.b1.tov, 1, "an offensive foul is also a turnover");
  assert.equal(s.ball, "a", "and gives the ball away");
  assert.equal(s.team.a.benchTechs, 1);
  assert.equal(s.teamFouls.a.P1, 2, "a bench technical is not a team foul");
  assert.equal(s.teamFouls.b.P1, 1, "FIBA: an offensive foul is a team foul");
  const fouls = m.stats().teams;
  assert.equal(cell(fouls, "teamFouls", "a", "ftAwarded"), 3, "2 on the shot and 1 for the technical; a common foul outside the bonus gives none");
  assert.equal(cell(fouls, "teamFouls", "b", "ftAwarded"), 0);
  m.refuses("FOUL", { side: "a", player: "a1", kind: "elbow" }, /Unknown foul/, "made-up foul type");
  m.refuses("FOUL", { side: "a", player: "a1", kind: "offensive", freeThrows: 2 }, /no free throws/, "free throws on an offensive foul");
  m.refuses("FOUL", { side: "a", player: "a1", kind: "technical", on: "b1" }, /not committed on a player/, "technical on a player");
  m.refuses("FOUL", { side: "a", player: "a1", on: "a2" }, /other team/, "fouling a team mate");
  m.refuses("FOUL", { side: "a", player: "a1", freeThrows: 4 }, /0 to 3/, "four free throws");
});

section("basketball: team fouls and the bonus follow the competition (FIBA, NBA, NCAA)", () => {
  const fiba = openMatch(E, ctx);
  fiba.push("MATCH_START"); fiba.push("PERIOD_START");
  for (let i = 0; i < 3; i++) fiba.push("FOUL", { side: "a", player: `a${i + 1}` });
  assert.equal(bonusFor(fiba.env.sport, "b", fiba.rules), null);
  fiba.push("FOUL", { side: "a", player: "a4" });
  assert.equal(bonusFor(fiba.env.sport, "b", fiba.rules), "bonus", "FIBA: from the 5th team foul, after 4");
  const facts = Object.fromEntries(fiba.summary().view.facts.map((f) => [f.label, f]));
  assert.deepEqual([facts["Team fouls"].a, facts.Bonus.b, facts.Bonus.a], ["4", "Bonus", "No"]);
  fiba.push("PERIOD_END");
  assert.equal(bonusFor(fiba.env.sport, "b", fiba.rules), null, "team fouls start again each FIBA period");
  periods(fiba, 3);
  fiba.push("PERIOD_START");                                      // overtime carries the 4th period's fouls (none)
  assert.equal(fiba.env.sport.teamFouls.a.P4 ?? 0, 0);

  const nba = openMatch(E, ctx, { preset: "nba" });
  nba.push("MATCH_START"); nba.push("PERIOD_START");
  nba.push("FOUL", { side: "a", player: "a1", kind: "offensive" });
  nba.push("FOUL", { side: "a", player: "a2", kind: "technical" });
  nba.push("FREE_THROW_MISSED", { side: "b", player: "b3" });   // the technical free throw: any Bravo player
  assert.equal(nba.env.sport.teamFouls.a.P1 ?? 0, 0, "NBA: offensive fouls and technicals are not team fouls");
  assert.equal(nba.env.sport.players.a2.pf ?? 0, 0, "NBA: a technical does not count toward fouling out");
  nba.push("PERIOD_END"); periods(nba, 3);
  nba.push("PERIOD_START");
  for (let i = 0; i < 3; i++) nba.push("FOUL", { side: "a", player: `a${i + 3}` });
  assert.equal(bonusFor(nba.env.sport, "b", nba.rules), "bonus", "NBA overtime: penalty from the 4th foul");

  const ncaa = openMatch(E, ctx, { preset: "ncaa" });
  ncaa.push("MATCH_START"); ncaa.push("PERIOD_START");
  for (let i = 0; i < 5; i++) ncaa.push("FOUL", { side: "a", player: `a${(i % 6) + 1}` });
  assert.equal(bonusFor(ncaa.env.sport, "b", ncaa.rules), null);
  ncaa.push("FOUL", { side: "a", player: "a6" });
  assert.equal(bonusFor(ncaa.env.sport, "b", ncaa.rules), "bonus", "NCAA: one-and-one from the 7th foul of the half");
  for (let i = 0; i < 3; i++) ncaa.push("FOUL", { side: "a", player: `a${i + 1}` });
  assert.equal(bonusFor(ncaa.env.sport, "b", ncaa.rules), "double", "NCAA: double bonus from the 10th");
  assert.equal(ncaa.env.sport.freeThrows.length, 3, "fouls 7, 8 and 9 each gave a one-and-one");
  ncaa.refuses("PERIOD_END", {}, /Finish the free throws first/, "ending the half with free throws to take");
  for (let i = 0; i < 3; i++) ncaa.push("FREE_THROW_MISSED", { side: "b" });
  assert.equal(ncaa.env.sport.freeThrows.length, 0, "a missed front end ends a one-and-one");
  ncaa.push("PERIOD_END");
  assert.equal(bonusFor(ncaa.env.sport, "b", ncaa.rules), null, "a new half starts again");
});

section("basketball: fouling out and disqualification", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  for (let i = 0; i < 5; i++) m.push("FOUL", { side: "a", player: "a5", kind: i === 4 ? "technical" : "personal" });
  m.refuses("SHOT_MADE", { side: "a", player: "a5", points: 2 }, /fouled out/, "FIBA: 4 personal + 1 technical is 5");
  assert.ok(E.derivedLog(m.env.sport).some((l) => /Alpha 5 fouled out/.test(l.text)));
  m.push("FOUL", { side: "a", player: "a1", kind: "technical" });
  m.push("FOUL", { side: "a", player: "a1", kind: "technical" });
  assert.equal(m.env.sport.out.a1, "disqualified", "two technicals");
  m.push("FOUL", { side: "a", player: "a2", kind: "technical" });
  m.push("FOUL", { side: "a", player: "a2", kind: "unsportsmanlike" });
  assert.equal(m.env.sport.out.a2, "disqualified", "FIBA: a technical and an unsportsmanlike together");
  m.push("FOUL", { side: "b", player: "b1", kind: "disqualifying" });
  assert.equal(m.env.sport.out.b1, "disqualified");
  m.refuses("FREE_THROW_MADE", { side: "b", player: "b1" }, /disqualified/, "disqualified player");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a6"] }, /fouled out or disqualified/, "disqualified player in a lineup");
  assert.equal(cell(m.stats().players, "fouls", "a1", "status"), "Disqualified");

  const nba = openMatch(E, ctx, { preset: "nba" });
  nba.push("MATCH_START"); nba.push("PERIOD_START");
  for (let i = 0; i < 5; i++) nba.push("FOUL", { side: "a", player: "a1" });
  assert.equal(nba.env.sport.out.a1, undefined, "NBA: 5 fouls is not out");
  nba.push("FOUL", { side: "a", player: "a1" });
  assert.equal(nba.env.sport.out.a1, "fouled_out", "NBA: the 6th");
});

// ── timeouts ───────────────────────────────────────────────────────

section("basketball: timeouts are limited by the competition", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.refuses("TIMEOUT", { side: "a" }, /during a period/, "timeout before tip-off");
  m.push("PERIOD_START");
  m.push("TIMEOUT", { side: "a" }); m.push("TIMEOUT", { side: "a" });
  m.refuses("TIMEOUT", { side: "a" }, /no timeouts left in the first half/, "FIBA: 2 in the first half");
  m.push("PERIOD_END"); m.push("PERIOD_START");
  m.refuses("TIMEOUT", { side: "a" }, /first half/, "still the first half");
  assert.equal(timeoutsLeft(m.env.sport, "b", m.rules), 2);
  m.push("PERIOD_END"); m.push("PERIOD_START");
  assert.equal(timeoutsLeft(m.env.sport, "a", m.rules), 3, "FIBA: 3 in the second half");
  for (let i = 0; i < 3; i++) m.push("TIMEOUT", { side: "a" });
  m.refuses("TIMEOUT", { side: "a" }, /second half/, "a 4th in the second half");
  const facts = Object.fromEntries(m.summary().view.facts.map((f) => [f.label, f]));
  assert.deepEqual([facts["Timeouts left"].a, facts["Timeouts left"].b], ["0", "3"]);

  const nba = openMatch(E, ctx, { preset: "nba" });
  nba.push("MATCH_START"); nba.push("PERIOD_START");
  for (let i = 0; i < 7; i++) nba.push("TIMEOUT", { side: "b" });
  nba.refuses("TIMEOUT", { side: "b" }, /this game/, "NBA: 7 per game");
});

// ── lineups, minutes, ratings ──────────────────────────────────────

section("basketball: metrics are withheld when the data is insufficient", () => {
  const m = openMatch(E, ctx, { trackShotAttempts: false });
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push(...made("a", "a1", 2));
  const s = m.stats();
  assert.equal(cell(s.players, "box", "a1", "fgPct"), null, "misses are not tracked, so 1 of 1 is not 100%");
  assert.equal(cell(s.teams, "team", "a", "offRating"), null);
  assert.equal(cell(s.teams, "team", "a", "possessions"), null, "possessions are not counted without misses");
  assert.equal(cell(s.teams, "team", "a", "secondChancePts"), null);
  assert.equal(cell(s.players, "box", "a1", "eff"), null);
  assert.equal(cell(s.players, "box", "a1", "min"), null, "no lineups: minutes unknown");
  assert.equal(cell(s.players, "box", "a1", "plusMinus"), null);
  assert.equal(cell(s.players, "box", "a1", "ptsPerMin"), null);
  assert.equal(cell(s.players, "box", "a1", "offRating"), null);
});

section("basketball: minutes, plus/minus, usage, on-court ratings and bench points", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  lineups(m);
  m.push("PERIOD_START");
  m.push("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 540 });
  m.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1", clock: 300 });
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 290 }, /not on court/, "benched player scoring");
  m.refuses("SUBSTITUTION", { side: "a", in: "a6", out: "a2", clock: 280 }, /already on court/, "double sub in");
  m.refuses("SHOT_MADE", { side: "a", player: "a6", points: 2, clock: 310 }, /cannot run backwards/, "clock going up");
  m.refuses("SHOT_MADE", { side: "a", player: "a2", points: 2, assist: "a1", clock: 290 }, /not on court/, "assist from the bench");
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
  assert.equal(cell(box, "box", "a1", "usgPct"), 100, "a1 used the only Alpha shot while on court");
  assert.equal(cell(box, "box", "a1", "offRating"), 200, "2 points in 1 possession on court");
  assert.equal(cell(box, "box", "a1", "defRating"), null, "never on court for a Bravo possession");
  assert.equal(cell(box, "box", "a2", "offRating"), 250, "5 points in 2 possessions");
  assert.equal(cell(box, "box", "a2", "defRating"), 0);
  assert.equal(cell(m.stats().teams, "team", "a", "benchPts"), 3);
  m.assertReconstructs("lineups");

  const noClock = openMatch(E, ctx);
  noClock.push("MATCH_START");
  lineups(noClock);
  noClock.push("PERIOD_START");
  noClock.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1" });
  assert.equal(cell(noClock.stats().players, "box", "a6", "min"), null, "a substitution without a clock makes minutes unknowable");
});

section("basketball: invalid participation is refused", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.refuses("SHOT_MADE", { side: "a", player: "b1", points: 2 }, /not in Alpha/, "opponent's player");
  m.refuses("SHOT_MADE", { side: "a", player: "zz", points: 2 }, /not in Alpha/, "unknown player");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, assist: "a1" }, /own basket/, "self assist");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, assist: "b2" }, /team mate/, "assist from the other team");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3, paint: true }, /not in the paint/, "three in the paint");
  m.refuses("SHOT_MISSED", { side: "a", player: "a1", points: 2, assist: "a2" }, /no assist/, "assist on a miss");
  m.refuses("REBOUND", { side: "a", player: "a1" }, /offensive or defensive/, "untyped rebound");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2"] }, /exactly 5/, "short lineup");
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "b1"] }, /belong to that side/, "a player on both teams");
  m.refuses("SUBSTITUTION", { side: "a", in: "a6", out: "a1" }, /Set the lineup/, "sub before lineup");
  m.refuses("SHOT_MADE", { player: "a1", points: 2 }, /which side/, "no team");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 700 }, /longer than the period/, "impossible clock");
  m.refuses("OFFICIALS", { names: [] }, /official/, "no official names");
});

section("basketball: a game roster is 12, five on court and seven on the bench", () => {
  assert.deepEqual(["fiba", "nba", "ncaa"].map((preset) => E.resolveRules({ preset }).gameRosterSize), [12, 13, 15]);
  assert.throws(() => E.resolveRules({ gameRosterSize: 4 }), RulesError, "fewer than the players on court");

  const big = makeContext("basketball", 14);
  const m = openMatch(E, big);
  m.push("MATCH_START");
  m.refuses("PERIOD_START", {}, /14 players registered. Choose the 12/, "tip-off with 14 dressed");
  assert.match(m.summary().view.notes.join(" "), /choose 12 of 14/);
  const twelve = (side) => Array.from({ length: 12 }, (_, i) => `${side}${i + 1}`);
  m.refuses("ROSTER", { side: "a", players: [...twelve("a"), "a13"] }, /at most 12 players \(5 on court and 7 substitutes\)/, "13 dressed");
  m.refuses("ROSTER", { side: "a", players: ["a1", "b1"] }, /belong to that team/, "an opponent in the roster");
  m.push("ROSTER", { side: "a", players: twelve("a") });
  m.push("ROSTER", { side: "b", players: twelve("b") });
  m.refuses("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a13"] }, /not in the game roster/, "an undressed starter");
  m.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  m.push("LINEUP", { side: "b", players: ["b1", "b2", "b3", "b4", "b5"] });
  assert.equal(benchOf(m.env.sport, big, "a").length, 7, "seven substitutes on the bench");
  m.push("PERIOD_START");
  m.refuses("ROSTER", { side: "a", players: twelve("a") }, /before tip-off/, "changing the roster mid-game");
  m.refuses("SUBSTITUTION", { side: "a", in: "a14", out: "a1" }, /not in the game roster/, "an undressed substitute");
  m.refuses("SHOT_MADE", { side: "a", player: "a14", points: 2 }, /not dressed/, "an undressed player scoring");
  m.push("SUBSTITUTION", { side: "a", in: "a12", out: "a1" });
  m.push(...made("a", "a12", 2));
  assert.equal(m.stats().players[0].rows.filter((r) => r.side === "a").length, 12, "the box score lists the 12 dressed");
  m.push("PERIOD_END"); periods(m, 3); m.push("MATCH_COMPLETE");
  const lines = m.stats().lines.filter((l) => l.subject === "player" && l.side === "a");
  assert.equal(lines.length, 12, "only dressed players are credited with a game played");
  m.assertReconstructs("game roster");
});

section("basketball: a team short of five plays with everyone it has left", () => {
  const small = makeContext("basketball", 6);
  const m = openMatch(E, small);
  m.push("MATCH_START");
  m.push("LINEUP", { side: "a", players: ["a1", "a2", "a3", "a4", "a5"] });
  m.push("PERIOD_START");
  for (const id of ["a1", "a2"]) for (let i = 0; i < 5; i++) m.push("FOUL", { side: "a", player: id });
  assert.equal(eligibleOf(m.env.sport, small, "a").length, 4);
  m.refuses("LINEUP", { side: "a", players: ["a3", "a4", "a5"] }, /Only 4 players are still eligible: the lineup needs all of them/, "leaving an eligible player off");
  m.push("LINEUP", { side: "a", players: ["a3", "a4", "a5", "a6"] });
  assert.match(m.summary().view.notes.join(" "), /Alpha has only 4 eligible players/);
});

// ── shots ──────────────────────────────────────────────────────────

section("basketball: shot zones and shot types, only when recorded", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push(...made("a", "a1", 2, { zone: "paint", shotType: "layup" }));
  m.push(...made("a", "a1", 3, { zone: "corner_three", shotType: "catch_and_shoot" }));
  m.push("SHOT_MISSED", { side: "a", player: "a2", points: 2, zone: "mid_range", shotType: "pull_up" });
  m.push(...made("b", "b1", 2));                                  // no detail recorded
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, zone: "corner_three" }, /beyond the arc/, "a 2 from the corner three");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3, zone: "paint" }, /inside the arc/, "a 3 from the paint");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, shotType: "slam" }, /Unknown shot type/, "made-up shot type");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, x: 120, y: 5 }, /0 to 100/, "off the court");
  assert.equal(cell(m.stats().teams, "team", "a", "paintPts"), 2);
  const an = m.analytics();
  assert.deepEqual(row(an, "zones", "paint-a").values, { fgm: 1, fga: 1, fgPct: 100, pts: 2 });
  assert.deepEqual(row(an, "zones", "mid_range-a").values, { fgm: 0, fga: 1, fgPct: 0, pts: 0 });
  assert.equal(table(an, "zones").rows.some((r) => r.side === "b"), false, "no zone data is invented for Bravo");
  assert.ok(an.charts.some((c) => c.key === "zones"));
  assert.equal(row(an, "shotTypes", "layup-a").values.fgm, 1);
});

// ── momentum, clutch, analytics ────────────────────────────────────

section("basketball: lead changes, largest lead, runs and comebacks", () => {
  const m = fullGame();
  assert.deepEqual(leadStats(m.env.sport.scoring), { leadChanges: 2, timesTied: 2, largestLead: { a: 5, b: 3 } });
  assert.deepEqual(scoringRunsOf(m.env.sport.scoring, 6).map(({ side, points, period }) => ({ side, points, period })), [{ side: "b", points: 8, period: 1 }, { side: "a", points: 6, period: 3 }]);
  assert.deepEqual(comebacks(m.env.sport.scoring), { a: 3, b: 5 }, "Bravo were 5 down, then led; Alpha were 3 down, then led");
  const an = m.analytics();
  assert.equal(card(an, "Lead changes"), "2");
  const prog = an.charts.find((c) => c.key === "progression");
  assert.deepEqual(prog.series[0].values, [0, 2, 5, 5, 5, 5, 5, 8, 11, 11]);
  assert.deepEqual(prog.series[1].values, [0, 0, 0, 1, 4, 6, 8, 8, 8, 11]);
  const byPeriod = an.charts.find((c) => c.key === "by-period");
  assert.deepEqual(byPeriod.series[0].values, [5, 0, 6, 0]);
  assert.ok(an.insights.some((i) => /Bravo had a 8-0 run in Q1/.test(i)));
  assert.ok(E.derivedLog(m.env.sport).some((l) => /Bravo on a 8-0 run/.test(l.text)), "the run is called out in the play-by-play");
  assert.ok(E.derivedLog(m.env.sport).some((l) => /Score 11-11/.test(l.text)), "the score after each scoring play");
  assert.equal(row(an, "leaders", "pts").values.who, "2 Alpha 2");
});

section("basketball: scoring droughts and run durations need the clock", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.push(...made("a", "a1", 2, { clock: 590 }));
  m.push(...made("a", "a1", 3, { clock: 400 }));
  m.push(...made("a", "a2", 3, { clock: 380 }));
  m.push(...made("b", "b1", 2, { clock: 100 }));
  m.push("PERIOD_END");
  const runs = scoringRunsOf(m.env.sport.scoring, 6);
  assert.equal(runs[0].seconds, 210, "the 8-0 run took 3:30 of game clock");
  const momentum = row(m.analytics(), "momentum", "b");
  assert.equal(momentum.values.drought, "08:20 (Q1)", "Bravo's first score came after 8:20");
});

section("basketball: clutch figures (configurable, and only with a clock)", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  periods(m, 3);
  m.push("PERIOD_START");
  m.push(...made("a", "a1", 2, { clock: 500 }));                  // 5:00 not reached yet
  m.push(...made("b", "b1", 2, { clock: 290 }));                  // clutch: within 5 points, last 5 minutes
  m.push(...made("a", "a1", 3, { clock: 100 }));
  m.push("FREE_THROW_MISSED", { side: "b", player: "b1", clock: 50 });
  m.push("PERIOD_END");
  const clutch = table(m.analytics(), "clutch");
  assert.ok(clutch, "a clutch table once clutch time was reached and clocked");
  assert.equal(clutch.rows.find((r) => r.id === "a1").values.pts, 3, "the 2 at 8:20 was before clutch time");
  assert.equal(clutch.rows.find((r) => r.id === "b1").values.ftPct, 0);

  const loose = openMatch(E, ctx, { clutchMinutes: 2, clutchMargin: 3 });
  loose.push("MATCH_START"); periods(loose, 3); loose.push("PERIOD_START");
  loose.push(...made("a", "a1", 2, { clock: 150 }));             // outside a 2-minute window
  loose.push(...made("b", "b1", 2));                              // no clock: clutch can no longer be measured
  loose.push("PERIOD_END");
  assert.equal(table(loose.analytics(), "clutch"), undefined, "never shown without a clock on every late event");
  assert.ok(loose.analytics().insights.some((i) => /need a clock/.test(i)));
});

// ── integrity ──────────────────────────────────────────────────────

section("basketball: reconstruction checks the score against the baskets", () => {
  const m = fullGame();
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  const tampered = structuredClone(m.env.sport);
  tampered.score.a = 99;
  assert.ok(E.validateScore(tampered, ctx, m.rules).some((i) => i.code === "IMPOSSIBLE_SCORE"));
  const inflated = structuredClone(m.env.sport);
  inflated.players.a1.pts = 50;
  assert.ok(E.validateScore(inflated, ctx, m.rules).some((i) => /add up to more than the team/.test(i.message)), "a player's points exceeding the team's");
});

section("basketball: a corrected or deleted scoring event recalculates everything", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const three = m.push(...made("a", "a1", 3, { assist: "a2" }));
  const two = m.push(...made("b", "b1", 2));
  m.push(...made("a", "a3", 2));
  m.correct("void", three.id, "Wrong player: it was not a basket");
  assert.deepEqual(m.env.sport.score, { a: 2, b: 2 });
  assert.equal(m.env.sport.players.a1?.pts ?? 0, 0);
  assert.equal(m.env.sport.players.a2?.ast ?? 0, 0, "the assist goes with the basket");
  m.correct("replace", two.id, "It was a three", "SHOT_MADE", { side: "b", player: "b1", points: 3 });
  assert.deepEqual(m.env.sport.score, { a: 2, b: 3 });
  assert.equal(m.env.sport.team.b.tpm, 1);
  assert.deepEqual(E.validateScore(m.env.sport, ctx, m.rules), []);
  m.assertReconstructs("corrections");
});

section("basketball: duplicate, offline and simultaneous submissions", () => {
  const m = possessionGame();
  const base = reconstruct(E, ctx, m.rules, m.events);
  // the same tap resent after a dropped connection: same client id, stored once
  const resent = { ...m.events[5], id: "dup", seq: m.events.length + 1 };
  const withDup = reconstruct(E, ctx, m.rules, [...m.events, resent]);
  assert.ok(withDup.issues.some((i) => i.code === "DUPLICATE_EVENT"));
  assert.deepEqual(withDup.envelope.sport.score, base.envelope.sport.score, "a resent event is not counted twice");
  // an offline queue replayed later, in its original order, rebuilds the same game
  const replay = openMatch(E, ctx);
  for (const ev of m.events) replay.push(ev.type, ev.payload);
  assert.deepEqual(replay.env.sport, m.env.sport);
  // two scorers writing the same sequence number at once: the second is flagged (the database refuses it)
  const clash = effectiveEvents([...m.events, { ...m.events[3], id: "other-scorer", clientId: "other" }]);
  assert.ok(clash.issues.some((i) => i.code === "DUPLICATE_SEQUENCE"));
});

section("basketball: officials and the game summary", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.push("OFFICIALS", { names: ["R. Thapa", "S. Karki"] });
  m.push("PERIOD_START"); m.push(...made("a", "a1", 2));
  const lines = m.summary().lines;
  assert.ok(lines.includes("Officials: R. Thapa, S. Karki"));
  assert.ok(lines.includes("Top scorers: Alpha 1 2"));
});

// ── knowledge ──────────────────────────────────────────────────────

section("basketball: questions are answered from the game's own data", () => {
  const m = possessionGame();
  const ask = (q) => E.answerQuestion(m.env.sport, ctx, m.rules, q);
  assert.equal(ask("What is the score?").answer, "Bravo lead 11-5 (End of Q1).");
  assert.equal(ask("Who is leading?").answer, "Bravo lead 11-5 (End of Q1).");
  assert.equal(ask("How many points has Alpha 1 scored?").answer, "Alpha 1 has 3 points.");
  assert.equal(ask("How many fouls does Bravo 3 have?").answer, "Bravo 3 has 1 foul.");
  assert.equal(ask("Who has the most rebounds?").answer, "Alpha 2 and Alpha 3 lead with 1 rebounds.");
  assert.equal(ask("How many three-pointers has Bravo made?").answer, "Bravo have made 1 three pointers (1-2).");
  assert.equal(ask("What was the biggest scoring run?").answer, "The biggest run is 9-0 by Bravo in Q1.");
  assert.equal(ask("How many points did Bravo score in Q1?").answer, "In Q1: Bravo 11.");
  assert.equal(ask("What is the team's shooting percentage?").answer, "Alpha are shooting 66.7% from the field (2-3); Bravo are shooting 83.3% from the field (5-6).");
  assert.match(ask("How many possessions have occurred?").answer, /^Alpha have had 6 possessions, Bravo 6/);
  const why = ask("What caused the current lead?").answer;
  assert.match(why, /^Bravo lead by 6/);
  assert.match(why, /9-0 run/);
  assert.match(why, /points off turnovers/);
  assert.equal(ask("Who has a double-double?").answer, "Nobody has a double-double.");
  assert.equal(ask("Is this game in overtime?").answer, "No. End of Q1.");
  assert.equal(ask("How many timeouts does Alpha have left?").answer, "Alpha have 2 timeouts left.");
  assert.equal(ask("What is Alpha 1's plus minus?").answer, "Alpha 1's plus/minus is not available: it needs both lineups set before the first basket.");
  assert.equal(ask("What is the weather like?").kind, "unknown", "nothing is invented");

  const off = openMatch(E, ctx, { trackShotAttempts: false });
  off.push("MATCH_START"); off.push("PERIOD_START"); off.push(...made("a", "a1", 2));
  assert.match(E.answerQuestion(off.env.sport, ctx, off.rules, "How many possessions?").answer, /not available/);
  assert.match(E.answerQuestion(off.env.sport, ctx, off.rules, "What is Alpha's field goal percentage?").answer, /not available: missed shots are not being recorded/);
});

section("basketball: the glossary explains the game's terms", () => {
  const ask = (q) => E.answerQuestion(fullGame().env.sport, ctx, E.resolveRules({}), q);
  assert.equal(ask("What is a pick and roll?").kind, "glossary");
  assert.match(ask("What is a pick and roll?").answer, /^Pick and roll: /);
  assert.match(ask("explain zone defence").answer, /^Zone defense: /);
  assert.match(ask("What does and-one mean?").answer, /^And-one: /);
  assert.match(ask("What is a triple double?").answer, /^Triple-double: /);
  for (const term of ["Alley-oop", "Backcourt violation", "Bonus", "Carrying", "Charge", "Goaltending", "Shot clock", "Traveling", "Three-and-D", "Dagger", "Isolation", "Post-up", "Pick and pop"]) {
    assert.ok(GLOSSARY.some((g) => g.term === term), `${term} is explained`);
  }
});

// ── score and rule intelligence ───────────────────────────────────

const live = (rules = {}) => { const m = openMatch(E, ctx, rules); m.push("MATCH_START"); m.push("PERIOD_START"); return m; };
// the latest explanation of a kind; by default the latest that is not about possession
const lastWhy = (m, kind) => [...m.env.sport.recent].reverse().find((x) => (kind ? x.kind === kind : x.kind !== "possession"))?.text;
const ask = (m, q) => E.answerQuestion(m.env.sport, ctx, m.rules, q).answer;

section("rules: only made baskets, made free throws and goaltending change the score", () => {
  const m = live();
  m.push("TWO_POINT_MADE", { side: "a", player: "a1" });
  assert.equal(m.env.sport.score.a, 2, "TWO_POINT_MADE is +2");
  assert.equal(lastWhy(m), "Alpha's score changed from 0 to 2 because Alpha 1 made a two-point field goal (+2).");
  m.push("THREE_POINT_MISSED", { side: "b", player: "b1" });
  assert.equal(m.env.sport.score.b, 0, "a missed three is +0");
  assert.equal(lastWhy(m), "The score did not change: Bravo 1's three-point shot was recorded as missed.");
  m.push("3PT_MADE", { side: "a", player: "a2" });
  assert.equal(m.env.sport.score.a, 5);
  m.push("FREE_THROW_MISSED", { side: "b", player: "b1" });
  assert.equal(m.env.sport.score.b, 0, "a missed free throw is +0");
  m.refuses("3PT_MADE", { side: "a", player: "a2", points: 2 }, /worth 3, not 2/, "a three recorded as 2 points");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: -2 }, /worth 2 or 3/, "negative points");
  assert.deepEqual(m.env.sport.scoring.map((e) => [e.seq, e.pts, e.a, e.b]), [[3, 2, 2, 0], [5, 3, 5, 0]], "each scoring event keeps its points and the score after it");
  m.assertReconstructs("aliases");
});

section("rules: a client's expected score is checked (previous + points = new)", () => {
  const m = live();
  m.push(...made("a", "a1", 3, { expectedScore: { a: 3, b: 0 } }));
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 3, expectedScore: { a: 7, b: 0 } }, /Scoring inconsistency: 3-0 plus 3 for Alpha is 6-0, not 7-0/, "75 + 3 is not 79");
  m.refuses("SHOT_MISSED", { side: "a", player: "a1", points: 2, expectedScore: { a: 5, b: 0 } }, /with no score change is 3-0, not 5-0/, "a miss that claims points");
});

section("rules: and-one is a basket, a shooting foul and a free throw, recorded separately", () => {
  const m = live();
  m.push(...made("a", "a1", 2));
  m.push("FOUL", { side: "b", player: "b2", kind: "shooting", on: "a1" });
  const set = m.env.sport.freeThrows[0];
  assert.deepEqual([set.side, set.player, set.total], ["a", "a1", 1], "the rules award one free throw to the fouled shooter");
  m.refuses("SHOT_MADE", { side: "b", player: "b1", points: 2 }, /Finish the free throws first: Alpha 1, free throw 1 of 1/, "play before the free throw");
  m.refuses("FREE_THROW_MADE", { side: "b", player: "b1" }, /Alpha are taking free throws now/, "the wrong team shooting");
  m.refuses("FREE_THROW_MADE", { side: "a", player: "a2" }, /Alpha 1 was fouled and takes these free throws/, "the wrong shooter");
  m.push("FREE_THROW_MADE", { side: "a" });                        // shooter filled in from the foul
  assert.equal(m.env.sport.score.a, 3, "+2 then +1, never a single +3");
  const a1 = m.env.sport.players.a1;
  assert.deepEqual([a1.fgm, a1.fga, a1.ftm, a1.fta, a1.pts], [1, 1, 1, 1, 3]);
  assert.equal(m.env.sport.players.b2.foulsShooting, 1);
  assert.equal(m.env.sport.freeThrows.length, 0);
  assert.equal(lastWhy(m), "Alpha's score changed from 2 to 3 because Alpha 1 made free throw 1 of 1 (+1).");
  assert.equal(m.env.sport.possessions.filter((x) => x.side === "a").length, 1, "the and-one is the same possession");
  m.assertReconstructs("and-one");
});

section("rules: fouled on a missed shot gives the shot's value in free throws, each attempt separate", () => {
  const m = live();
  m.push("SHOT_MISSED", { side: "a", player: "a1", points: 3 });
  m.push("FOUL", { side: "b", player: "b1", kind: "shooting", on: "a1" });
  assert.equal(m.env.sport.freeThrows[0].total, 3, "a 3-point attempt: 3 free throws");
  assert.equal(m.env.sport.players.a1.fga ?? 0, 0, "a fouled miss is not a field goal attempt");
  assert.equal(m.env.sport.players.a1.tpa ?? 0, 0);
  m.push("FREE_THROW_MADE", { side: "a" });
  m.push("FREE_THROW_MISSED", { side: "a" });
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2 }, /free throw 3 of 3/, "a shot before the last free throw");
  m.push("FREE_THROW_MADE", { side: "a" });
  assert.equal(m.env.sport.score.a, 2, "1 + 0 + 1: only the made attempts count");
  assert.equal(m.env.sport.players.a1.fta, 3);
  m.refuses("FREE_THROW_MADE", { side: "a", player: "a1" }, /Alpha 1's 3 free throws have all been taken. Another free throw needs a foul/, "a fourth free throw");
  m.assertReconstructs("fouled miss");
});

section("rules: common fouls give free throws only in the bonus, by the competition's rules", () => {
  const fiba = live();
  for (let i = 1; i <= 4; i++) fiba.push("FOUL", { side: "a", player: `a${i}` });
  assert.equal(fiba.env.sport.freeThrows.length, 0, "fouls 1 to 4: no free throws");
  assert.match(fiba.env.sport.recent.at(-1).text, /No free throws, because Alpha are not in the penalty yet \(4 team fouls\)/);
  fiba.push("FOUL", { side: "a", player: "a5", on: "b3" });
  assert.deepEqual([fiba.env.sport.freeThrows[0].player, fiba.env.sport.freeThrows[0].total, fiba.env.sport.freeThrows[0].oneAndOne], ["b3", 2, false], "the 5th: 2 shots");
  fiba.push("FREE_THROW_MADE", { side: "b" }); fiba.push("FREE_THROW_MADE", { side: "b" });

  const ncaa = live({ preset: "ncaa" });
  for (let i = 0; i < 6; i++) ncaa.push("FOUL", { side: "a", player: `a${i + 1}` });
  ncaa.push("FOUL", { side: "a", player: "a1", on: "b1" });
  assert.equal(ncaa.env.sport.freeThrows[0].oneAndOne, true, "NCAA 7th foul: one-and-one");
  ncaa.push("FREE_THROW_MADE", { side: "b" });
  assert.equal(ncaa.env.sport.freeThrows.length, 1, "a made front end earns the second shot");
  ncaa.push("FREE_THROW_MISSED", { side: "b" });
  assert.equal(ncaa.env.sport.freeThrows.length, 0);
});

section("rules: technical, offensive and unsportsmanlike fouls have their own consequences", () => {
  const m = live();
  m.push("JUMP_BALL", { side: "a" });
  m.push("FOUL", { side: "b", player: "b1", kind: "technical" });
  const t = m.env.sport.freeThrows[0];
  assert.deepEqual([t.side, t.player, t.total, t.technical], ["a", null, 1, true], "FIBA: 1 free throw, any player");
  m.push("FREE_THROW_MADE", { side: "a", player: "a4" });
  assert.equal(m.env.sport.ball, "a", "after a technical free throw the team that had the ball keeps it");
  assert.equal(E.resolveRules({ preset: "ncaa" }).technicalFreeThrows, 2, "NCAA: 2");

  m.push("FOUL", { side: "a", player: "a2", kind: "offensive" });
  assert.equal(m.env.sport.freeThrows.length, 0, "an offensive foul gives no free throws");
  assert.equal(m.env.sport.ball, "b");
  assert.equal(m.env.sport.players.a2.tov, 1, "and is a turnover");

  m.push("FOUL", { side: "a", player: "a3", kind: "unsportsmanlike", on: "b2" });
  assert.equal(m.env.sport.freeThrows[0].total, 2, "unsportsmanlike: 2 free throws");
  m.push("FOUL", { side: "a", player: "a4", kind: "technical" });
  assert.equal(m.env.sport.freeThrows[0].technical, true, "a technical's free throw is taken first");
  m.push("FREE_THROW_MISSED", { side: "b", player: "b5" });
  assert.equal(m.env.sport.freeThrows[0].player, "b2", "then the fouled player's two");
});

section("rules: traveling, double dribble and the ball going out change possession, never the score", () => {
  const m = live();
  m.push("JUMP_BALL", { side: "a" });
  const before = { ...m.env.sport.score };
  m.push("VIOLATION", { side: "a", player: "a1", kind: "traveling" });
  assert.deepEqual(m.env.sport.score, before, "score unchanged");
  assert.equal(m.env.sport.ball, "b", "ball to Bravo");
  assert.equal(m.env.sport.players.a1.tov, 1, "a violation is a turnover");
  assert.equal(lastWhy(m), "Bravo get the ball: Alpha 1 traveling. A violation changes possession, never the score.");
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2 }, /The basket cannot count: Alpha 1 traveling, so the ball went to Bravo/, "a basket after the violation");
  m.push(...made("b", "b1", 2));                                   // Bravo have it: the dead ball is over
  m.push("VIOLATION", { side: "a", player: "a2", kind: "double_dribble" });
  assert.equal(m.env.sport.ball, "b");
  assert.equal(m.env.sport.team.a.tov, 2);
  assert.match(ask(m, "Why did possession change?"), /Alpha 2 double dribble/);

  m.push("OUT_OF_BOUNDS", { side: "b", player: "b3" });            // Bravo had it and put it out
  assert.equal(m.env.sport.ball, "a");
  assert.equal(m.env.sport.players.b3.tov, 1);
  m.push("SHOT_MISSED", { side: "a", player: "a1", points: 2 });
  m.push("OUT_OF_BOUNDS", { side: "b", player: "b4" });            // the defence knocked it out
  assert.equal(m.env.sport.ball, "a", "the offence keeps the ball");
  assert.equal(m.env.sport.players.b4?.tov ?? 0, 0, "no turnover for the defence");
  m.push("VIOLATION", { side: "b", kind: "kicked_ball" });
  assert.equal(m.env.sport.ball, "a", "a defensive violation leaves the ball with the offence");
  m.refuses("VIOLATION", { side: "a", kind: "palming" }, /Unknown violation/, "a made-up violation");
  assert.deepEqual(m.env.sport.score, { a: 0, b: 2 });
  m.assertReconstructs("violations");
});

section("rules: goaltending awards the basket; basket interference by the offence does not", () => {
  const m = live();
  m.push("JUMP_BALL", { side: "a" });
  m.push("GOALTENDING", { side: "b", player: "b4", shooter: "a2", points: 2 });
  assert.equal(m.env.sport.score.a, 2, "the basket is awarded, not typed in");
  assert.deepEqual([m.env.sport.players.a2.fgm, m.env.sport.players.a2.pts], [1, 2]);
  assert.equal(lastWhy(m, "possession"), "Bravo have the ball because after the awarded basket, Bravo inbound the ball.");
  assert.ok(m.env.sport.recent.some((x) => x.text === "Alpha's score changed from 0 to 2 because goaltending was called on Bravo 4, so the two-point shot by Alpha 2 counts (+2)."));
  m.refuses("GOALTENDING", { side: "b", player: "b4", shooter: "b1", points: 2 }, /must be in Alpha/, "goaltending on your own team's shot");
  m.push("VIOLATION", { side: "b", player: "b1", kind: "basket_interference" });
  assert.equal(m.env.sport.score.b, 0, "offensive basket interference cancels the basket");
  m.assertReconstructs("goaltending");
});

section("rules: the shot clock only runs down, unless a rule resets it", () => {
  const m = live();
  m.push("JUMP_BALL", { side: "a" });
  m.push("SHOT_MISSED", { side: "a", player: "a1", points: 2, shotClock: 5 });
  m.refuses("TURNOVER", { side: "a", player: "a1", shotClock: 9 }, /cannot read 9: it was at 5/, "the shot clock going up");
  m.refuses("REBOUND", { side: "a", player: "a2", offensive: true, shotClock: 20 }, /beyond 14/, "a full reset after an offensive rebound");
  m.push("REBOUND", { side: "a", player: "a2", offensive: true, shotClock: 14 });
  m.push("VIOLATION", { side: "a", kind: "shot_clock", shotClock: 0 });
  m.push("SHOT_MISSED", { side: "b", player: "b1", points: 3, shotClock: 24 });  // a new possession: full clock
  m.refuses("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 10, shotClock: 12 }, /switched off/, "more shot clock than game clock");
});

section("rules: period flow, ties, overtime, undo and final-game protection", () => {
  const m = live();
  m.refuses("PERIOD_START", {}, /still in progress/, "Q1 to Q3: a period cannot open over another");
  m.push(...made("a", "a1", 2));
  const lastBasket = m.push(...made("b", "b1", 2));
  // undo the last event: everything it caused is recalculated, nothing is subtracted by hand
  m.correct("void", lastBasket.id, "Undone by the scorer");
  assert.deepEqual(m.env.sport.score, { a: 2, b: 0 });
  assert.equal(m.env.sport.players.b1?.pts ?? 0, 0);
  m.push(...made("b", "b1", 2));
  m.push("PERIOD_END");
  periods(m, 3);
  assert.equal(m.summary().view.periodLabel, "End of regulation", "2-2: tie, so overtime");
  m.refuses("MATCH_COMPLETE", {}, /Play overtime/, "finishing level");
  for (const ot of ["OT", "OT2", "OT3"]) {
    m.push("PERIOD_START");
    assert.equal(m.summary().view.periodLabel.split(",")[0], ot);
    m.push("PERIOD_END");
  }
  m.push("PERIOD_START"); m.push(...made("a", "a1", 3)); m.push("PERIOD_END");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "5-2, OT4");
  m.refuses("FREE_THROW_MADE", { side: "b", player: "b1" }, /over/, "scoring after the final");
  m.refuses("PERIOD_START", {}, /over/, "reopening a final game");
  m.assertReconstructs("overtimes and undo");
});

section("rules: questions about the rules are answered from the competition's configuration", () => {
  const m = live();
  assert.equal(ask(m, "How many points is a free throw?"), "A made free throw is worth 1 point. A missed one adds nothing.");
  assert.equal(ask(m, "How many points is a three-pointer?"), "A field goal from beyond the three-point line is worth 3 points.");
  assert.match(ask(m, "Does a missed free throw change the score?"), /^No\./);
  assert.match(ask(m, "What happens when the game is tied?"), /level at the end of the fourth quarter, a 5-minute overtime is played/);
  assert.match(ask(m, "When does overtime start?"), /overtime/);
  assert.equal(ask(m, "How many fouls can a player have?"), "A player fouls out on their 5th foul, technical fouls included. 2 technical fouls or 2 unsportsmanlike fouls also eject a player.");
  assert.match(ask(m, "What happens after a technical foul?"), /^The other team gets 1 free throw/);
  assert.match(ask(m, "What is a team bonus?"), /Once a team has 4 team fouls, every further common foul gives the other team 2 free throws/);
  const ncaa = live({ preset: "ncaa" });
  assert.match(ask(ncaa, "What is a team bonus?"), /counted per half.*6 team fouls.*one-and-one.*From the 10th foul it is two shots/);
  assert.match(ask(ncaa, "What happens after a technical foul?"), /gets 2 free throws/);
  assert.match(ask(live({ preset: "nba" }), "How many fouls can a player have?"), /6th foul \(technical fouls do not count/);

  m.push(...made("a", "a1", 2));
  m.push("FOUL", { side: "b", player: "b2", kind: "shooting", on: "a1" });
  assert.match(ask(m, "Why are free throws being taken?"), /and-one: the basket counted and the shooter was fouled/);
  m.push("FREE_THROW_MADE", { side: "a" });
  assert.equal(ask(m, "Why did the score increase by 1?"), "Alpha's score changed from 2 to 3 because Alpha 1 made free throw 1 of 1 (+1).");
  m.push("JUMP_BALL", { side: "a" });
  m.push("VIOLATION", { side: "a", player: "a3", kind: "traveling" });
  assert.match(ask(m, "Why did the basket not count?"), /Alpha 3 traveling/);
  assert.match(ask(m, "Why did possession change?"), /^Bravo get the ball: Alpha 3 traveling/);
});

// ── history ────────────────────────────────────────────────────────

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
  assert.equal(agg.values.mpg, null, "no lineups or clock in either game");
  assert.equal(agg.values.doubleDoubles, 0);
  const team = aggregate(E, "team", [g1.stats().lines.find((l) => l.subject === "team" && l.side === "a").raw]);
  assert.equal(team.values.ppg, 11);
  assert.equal(team.values.defRating, 137.5);
  assert.equal(team.values.offRating, 157.1);
});

// ── the scorer's running clocks ────────────────────────────────────

section("basketball: substitutions are unlimited unless the competition sets a limit", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); lineups(m); m.push("PERIOD_START");
  assert.equal(substitutionsLeft(m.env.sport, "a", m.rules), null, "unlimited by default");
  for (let i = 0; i < 6; i++) m.push("SUBSTITUTION", { side: "a", in: i % 2 ? "a5" : "a6", out: i % 2 ? "a6" : "a5" });

  const capped = openMatch(E, ctx, { preset: "custom", substitutionsPerGame: 2 });
  capped.push("MATCH_START"); lineups(capped); capped.push("PERIOD_START");
  capped.push("SUBSTITUTION", { side: "a", in: "a6", out: "a1" });
  capped.push("SUBSTITUTION", { side: "a", in: "a1", out: "a2" });
  assert.equal(substitutionsLeft(capped.env.sport, "a", capped.rules), 0);
  assert.equal(substitutionsLeft(capped.env.sport, "b", capped.rules), 2, "each team has its own allowance");
  capped.refuses("SUBSTITUTION", { side: "a", in: "a2", out: "a3" }, /used all 2 substitutions/, "a third substitution");
  capped.push("SUBSTITUTION", { side: "b", in: "b6", out: "b1" });
  capped.assertReconstructs("substitution limit");
  assert.throws(() => E.resolveRules({ substitutionsPerGame: -1 }), RulesError);
});

section("basketball: quarter breaks and half-time come from the competition", () => {
  const fiba = E.resolveRules({});
  assert.deepEqual(breakAfter(1, fiba), { minutes: 2, halftime: false });
  assert.deepEqual(breakAfter(2, fiba), { minutes: 15, halftime: true });
  assert.deepEqual(breakAfter(4, fiba), { minutes: 2, halftime: false }, "before overtime");
  const ncaa = E.resolveRules({ preset: "ncaa" });
  assert.equal(breakAfter(1, ncaa).halftime, true, "two halves: the first break is half-time");
  const custom = E.resolveRules({ preset: "custom", halftimeMinutes: 10, quarterBreakMinutes: 1 });
  assert.equal(breakAfter(2, custom).minutes, 10);
  assert.equal(breakAfter(3, custom).minutes, 1);
  // rules saved before these settings existed
  const old = { ...fiba }; delete old.halftimeMinutes; delete old.quarterBreakMinutes;
  assert.equal(breakAfter(2, old).minutes, 15);
});

section("basketball: the shot clock resets by rule after each event", () => {
  const r = E.resolveRules({});
  assert.equal(shotClockAfter("STEAL", { side: "a" }, 9, r), 24, "a steal starts a new possession");
  assert.equal(shotClockAfter("REBOUND", { side: "a", offensive: false }, 3, r), 24);
  assert.equal(shotClockAfter("REBOUND", { side: "a", offensive: true }, 3, r), 14, "offensive rebound: 14");
  assert.equal(shotClockAfter("FOUL", { side: "b", kind: "personal" }, 9, r), 14, "defensive foul under 14: up to 14");
  assert.equal(shotClockAfter("FOUL", { side: "b", kind: "personal" }, 20, r), 20, "defensive foul over 14: keeps running");
  assert.equal(shotClockAfter("FOUL", { side: "a", kind: "offensive" }, 9, r), 24, "an offensive foul is a turnover");
  assert.equal(shotClockAfter("FOUL", { side: "a", kind: "technical" }, 9, r), 9);
  assert.equal(shotClockAfter("SHOT_MISSED", { side: "a", points: 2 }, 9, r), 9, "a miss runs on until the rebound");
  assert.equal(shotClockAfter("SHOT_MADE", { side: "a", points: 2 }, 9, r), 24);
  assert.equal(shotClockAfter("VIOLATION", { side: "b", kind: "kicked_ball" }, 5, r), 14);
  assert.equal(shotClockAfter("VIOLATION", { side: "a", kind: "traveling" }, 5, r), 24);
  assert.equal(shotClockAfter("TIMEOUT", { side: "a" }, 5, r), 5);
  const ncaa = E.resolveRules({ preset: "ncaa" });
  assert.equal(shotClockAfter("REBOUND", { side: "a", offensive: true }, 3, ncaa), 20);
});

section("basketball: clock readings the engine would refuse are left off", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const s = () => m.env.sport;
  assert.deepEqual(clockReadings(s(), m.rules, "SHOT_MADE", { side: "a" }, 581.2, 17.4), { clock: 582, shotClock: 18 }, "rounded up, as a scoreboard shows");
  m.push("SHOT_MADE", { side: "a", player: "a1", points: 2, clock: 582, shotClock: 18 });
  assert.deepEqual(clockReadings(s(), m.rules, "SHOT_MADE", { side: "b" }, 590, 20), {}, "a clock set back past what was recorded");
  assert.deepEqual(clockReadings(s(), m.rules, "SHOT_MADE", { side: "b" }, 15, 20), { clock: 15 }, "less game time than shot clock: the shot clock is off");
  assert.deepEqual(clockReadings(s(), m.rules, "SHOT_MADE", { side: "b" }, null, 20), {}, "no clock running");
  assert.deepEqual(clockReadings(s(), m.rules, "PERIOD_START", {}, 300, 20), {});
  m.push("SHOT_MISSED", { side: "b", player: "b1", points: 2, clock: 570, shotClock: 14 });
  // the scorer reset the shot clock by hand where the rules do not: the reading is dropped, not refused
  assert.deepEqual(clockReadings(s(), m.rules, "TURNOVER", { side: "b", player: "b1" }, 565, 24), { clock: 565 });
  const none = openMatch(E, ctx, { preset: "custom", shotClockSeconds: null });
  none.push("MATCH_START"); none.push("PERIOD_START");
  assert.deepEqual(clockReadings(none.env.sport, none.rules, "SHOT_MADE", { side: "a" }, 500, 20), { clock: 500 });
});

section("basketball: a game scored on the running clocks is never refused for a reading", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); lineups(m);
  let game = 600, shot = 24;
  const fire = (type, payload = {}) => {
    m.push(type, { ...payload, ...clockReadings(m.env.sport, m.rules, type, payload, game, game < shot ? null : shot) });
    shot = shotClockAfter(type, payload, shot, m.rules);
  };
  const run = (seconds) => { game = Math.max(0, game - seconds); shot = Math.max(0, shot - seconds); };
  fire("PERIOD_START");
  run(7.3); fire("SHOT_MADE", { side: "a", player: "a1", points: 2 });
  run(11.8); fire("SHOT_MISSED", { side: "b", player: "b1", points: 3 });
  run(1.1); fire("REBOUND", { side: "b", player: "b2", offensive: true });
  run(4.6); fire("FOUL", { side: "a", player: "a2", kind: "personal" });
  run(9.9); fire("TURNOVER", { side: "b", player: "b1" });
  run(3); fire("STEAL", { side: "a", player: "a3" });
  shot = 24; // the scorer pressed "Shot clock 24" on a kicked ball
  run(2); fire("SHOT_MADE", { side: "a", player: "a3", points: 3 });
  game = 590; // and set the game clock back up past what was already recorded
  run(5); fire("SHOT_MADE", { side: "b", player: "b3", points: 2 });
  run(30); fire("TIMEOUT", { side: "a" });
  run(23.9); fire("SHOT_MADE", { side: "a", player: "a4", points: 2 });
  run(520); fire("SHOT_MISSED", { side: "b", player: "b4", points: 2 });
  run(6); fire("REBOUND", { side: "a", player: "a5", offensive: false });
  run(20); fire("PERIOD_END");
  assert.equal(m.env.sport.score.a, 7);
  assert.ok(m.events.filter((e) => e.payload.clock !== undefined).length >= 10, "most events carry the clock");
  m.assertReconstructs("running clocks");
});

section("basketball: clock text and typing a time", () => {
  assert.equal(clockText(402), "6:42");
  assert.equal(clockText(401.2), "6:42", "rounded up");
  assert.equal(clockText(60), "1:00");
  assert.equal(clockText(8.46), "8.4", "tenths in the last minute");
  assert.equal(clockText(0), "0.0");
  assert.equal(parseClock("6:42"), 402);
  assert.equal(parseClock("42"), 42);
  assert.equal(parseClock("8.4"), 8.4);
  assert.equal(parseClock("6:75"), null);
  assert.equal(parseClock("soon"), null);
});


// ── a game entered after the fact, and reopening a finished one ─────

section("basketball: a box score entered after the game feeds the score, stats and result", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.push("BOX_SCORE", { side: "a", lines: [
    { player: "a1", twos: 5, threes: 2, ftm: 3, fga: 14, tpa: 5, fta: 4, oreb: 2, dreb: 5, ast: 4, stl: 1, blk: 0, tov: 2, pf: 3 },
    { player: "a2", twos: 3, ftm: 1, fga: 8, fta: 2, dreb: 6, pf: 5 },
    { twos: 1 }, // points nobody was credited with
  ], periods: [8, 7, 7, 6] });
  m.refuses("BOX_SCORE", { side: "a", lines: [{ player: "a3", twos: 1 }] }, /already in. Correct it/, "a second box score for a side");
  m.refuses("MATCH_COMPLETE", {}, /Enter Bravo's box score too/, "one side missing");
  m.refuses("BOX_SCORE", { side: "b", lines: [{ player: "a3", twos: 1 }] }, /belong to that team/, "a player from the other team");
  m.refuses("BOX_SCORE", { side: "b", lines: [{ player: "b1", twos: 2, fga: 1 }] }, /more field goals made than attempted/, "made more than attempted");
  m.refuses("BOX_SCORE", { side: "b", lines: [{ player: "b1", twos: 2 }], periods: [1, 1, 1, 0] }, /add up to 3, but the players' points add up to 4/, "period scores that do not add up");
  m.push("BOX_SCORE", { side: "b", lines: [{ player: "b1", twos: 7, threes: 4, ftm: 2 }] });
  m.refuses("PERIOD_START", {}, /entered as a box score/, "play by play after a box score");
  assert.deepEqual(m.env.sport.score, { a: 28, b: 28 });
  m.refuses("MATCH_COMPLETE", {}, /cannot end level/, "a level box score");
  const b = m.events.find((e) => e.type === "BOX_SCORE" && e.payload.side === "b");
  m.correct("replace", b.id, "Missed a three on the sheet", "BOX_SCORE", { side: "b", lines: [{ player: "b1", twos: 7, threes: 5, ftm: 2 }] });
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.winner, "b");
  assert.equal(m.summary().view.periodLabel, "Box score");
  const box = m.stats().players;
  assert.equal(cell(box, "box", "a1", "pts"), 19);
  assert.equal(cell(box, "box", "a1", "reb"), 7);
  assert.equal(m.env.sport.out.a2, "fouled_out", "5 fouls in FIBA");
  assert.ok(m.env.sport.attemptsUnknown, "b1's line left out attempts");
  m.assertReconstructs("box score");
});

section("basketball: a finished match can be reopened to add what was missed", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.refuses("MATCH_REOPEN", {}, /Only a completed match/, "reopening a match in progress");
  periods(m, 1);
  m.push("PERIOD_START"); m.push(...made("a", "a1", 2)); m.push("PERIOD_END");
  periods(m, 2);
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.status, "completed");
  m.refuses("SHOT_MADE", { side: "b", player: "b1", points: 3 }, /over/, "scoring a finished match");
  m.push("MATCH_REOPEN", { reason: "A late three was not recorded" });
  assert.equal(m.env.status, "live");
  assert.equal(m.env.result, null);
  m.refuses("PERIOD_START", {}, /only played when the score is level/, "no overtime at 2-0");
  m.push("PERIOD_REOPEN");
  m.push(...made("b", "b1", 3)); m.push("PERIOD_END");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.winner, "b");
  m.assertReconstructs("reopened match");
});

section("basketball: a final score typed without the scorers is a box score of team points", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  m.refuses("BOX_SCORE", { side: "a", lines: [{ player: "a1", points: 10 }] }, /come from baskets/, "points on a player's line");
  m.push("BOX_SCORE", { side: "a", lines: [{ points: 71 }] });
  m.push("BOX_SCORE", { side: "b", lines: [{ player: "b1", twos: 4, threes: 1 }, { points: 55 }] });
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.sport.score, { a: 71, b: 66 });
  assert.equal(m.env.result.winner, "a");
  assert.equal(cell(m.stats().players, "box", "b1", "pts"), 11);
  m.assertReconstructs("team points");
});


section("basketball: editing a finished box score never passes through a level score", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  const a = m.push("BOX_SCORE", { side: "a", lines: [{ points: 60 }] });
  const b = m.push("BOX_SCORE", { side: "b", lines: [{ points: 58 }] });
  m.push("MATCH_COMPLETE");
  const done = m.events[m.events.length - 1];
  // the sheet had the totals the wrong way round: 58-60. Either side changed first would leave a finished game level
  assert.throws(() => m.correct("replace", a.id, "Totals swapped", "BOX_SCORE", { side: "a", lines: [{ points: 58 }] }), /level/);
  assert.throws(() => m.correct("replace", b.id, "Totals swapped", "BOX_SCORE", { side: "b", lines: [{ points: 60 }] }), /level/);
  // so the completion is reversed, both sides corrected, and the match completed again
  m.correct("void", done.id, "Totals swapped");
  m.correct("replace", a.id, "Totals swapped", "BOX_SCORE", { side: "a", lines: [{ points: 58 }] });
  m.correct("replace", b.id, "Totals swapped", "BOX_SCORE", { side: "b", lines: [{ points: 60 }] });
  m.push("MATCH_COMPLETE");
  assert.deepEqual(m.env.sport.score, { a: 58, b: 60 });
  assert.equal(m.env.result.winner, "b");
  m.assertReconstructs("edited box score");
});

section("basketball: a box score save is checked whole before anything is written", () => {
  const box = (side, points) => ({ side, lines: [{ points }] });
  const check = (m, current, completeId, changed, payload) =>
    checkBoxScoreSave(E, ctx, m.rules, m.env, m.events, m.events.length, current, completeId, changed, payload, "test");

  // a new match: start, both sides, complete
  const fresh = openMatch(E, ctx);
  check(fresh, { a: null, b: null }, null, ["a", "b"], { a: box("a", 70), b: box("b", 64) });
  assert.throws(() => check(fresh, { a: null, b: null }, null, ["a", "b"], { a: box("a", 70), b: box("b", 70) }), /cannot end level/, "a level final");
  assert.throws(() => check(fresh, { a: null, b: null }, null, ["a", "b"], { a: { side: "a", lines: [{ player: "b1", twos: 1 }] }, b: box("b", 2) }), /belong to that team/);
  assert.equal(fresh.events.length, 0, "the check writes nothing");

  // a finished one: the totals swapped is fine, a level edit is not
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  const a = m.push("BOX_SCORE", box("a", 60));
  const b = m.push("BOX_SCORE", box("b", 58));
  const done = m.push("MATCH_COMPLETE");
  const cur = { a: a.id, b: b.id };
  check(m, cur, done.id, ["a", "b"], { a: box("a", 58), b: box("b", 60) });
  check(m, cur, done.id, ["b"], { a: box("a", 60), b: box("b", 52) });
  assert.throws(() => check(m, cur, done.id, ["b"], { a: box("a", 60), b: box("b", 60) }), /level/);
});

