import assert from "node:assert/strict";
import { chasingSide, cricketPlayers, cricketTeams } from "../../src/lib/tournaments/cricketRecords.ts";
import { cricketEngine as E } from "../../src/lib/intelligence/sports/cricket.ts";
import { computeBasketballStandings, computeCricketStandings, diffText, standingsScheme } from "../../src/lib/tournaments/standings.ts";
import { section } from "./harness.mjs";

const team = (id, group = null, status = "confirmed") => ({ id, name: id, status, group_name: group });
let n = 0;
const game = (a, b, sa, sb, extra = {}) => {
  n += 1;
  return {
    id: `m${n}`, stage: "league", group_name: null, status: "completed", round: 1,
    team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_team_id: sa > sb ? a : sb > sa ? b : null,
    starts_at: new Date(Date.UTC(2026, 9, n)).toISOString(), created_at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(),
    ...extra,
  };
};

// A, B and C beat each other in a circle and all beat D: three teams on 5 points.
const teams = [team("Alpha"), team("Bravo"), team("Charlie"), team("Delta"), team("Echo", null, "withdrawn")];
const matches = [
  game("Alpha", "Bravo", 80, 70),
  game("Bravo", "Charlie", 90, 85),
  game("Charlie", "Alpha", 70, 60),
  game("Alpha", "Delta", 100, 50),
  game("Bravo", "Delta", 61, 60),
  game("Charlie", "Delta", 62, 60),
  game("Alpha", "Bravo", null, null, { stage: "knockout", status: "scheduled", winner_team_id: null }), // not a league game
];

section("standings: FIBA table points, and head-to-head among tied teams", () => {
  const t = computeBasketballStandings(matches, teams, {});
  assert.deepEqual(t.map((r) => r.team_name), ["Charlie", "Alpha", "Bravo", "Delta"], "games between the three decide it: Charlie +5, Alpha 0, Bravo -5");
  const alpha = t.find((r) => r.team_name === "Alpha");
  assert.deepEqual([alpha.played, alpha.won, alpha.lost, alpha.points, alpha.goals_for, alpha.goals_against, alpha.goal_diff], [3, 2, 1, 5, 240, 190, 50]);
  assert.equal(alpha.win_pct, 66.7);
  assert.equal(t.find((r) => r.team_name === "Delta").points, 3, "FIBA: a loss still earns 1");
  assert.equal(t.some((r) => r.team_name === "Echo"), false, "a withdrawn team is not in the table");
});

section("standings: overall point difference first when the competition says so", () => {
  const t = computeBasketballStandings(matches, teams, { standingsTiebreak: "point_difference" });
  assert.deepEqual(t.map((r) => r.team_name), ["Alpha", "Charlie", "Bravo", "Delta"], "Alpha +50, Charlie +7, Bravo -4");
});

section("standings: NBA-style tables rank on wins", () => {
  const t = computeBasketballStandings(matches, teams, { preset: "nba" });
  assert.deepEqual(t.map((r) => r.points), [2, 2, 2, 0]);
});

section("standings: a forfeit earns nothing and adds no points for or against", () => {
  const list = [game("Alpha", "Bravo", 70, 60), game("Bravo", "Alpha", null, null, { status: "walkover", winner_team_id: "Alpha" })];
  const t = computeBasketballStandings(list, [team("Alpha"), team("Bravo")], {});
  const bravo = t.find((r) => r.team_name === "Bravo");
  assert.deepEqual([bravo.played, bravo.lost, bravo.forfeits, bravo.points, bravo.goals_for, bravo.goals_against], [2, 2, 1, 1, 60, 70]);
  assert.equal(t[0].streak, "W2");
  assert.equal(bravo.last5, "LL");
});

section("standings: streaks, groups, and the sport's table vocabulary", () => {
  const list = [
    game("Alpha", "Bravo", 50, 40, { stage: "group", group_name: "A" }),
    game("Bravo", "Alpha", 55, 45, { stage: "group", group_name: "A" }),
    game("Bravo", "Alpha", 60, 59, { stage: "group", group_name: "A" }),
    game("Charlie", "Delta", 40, 30, { stage: "group", group_name: "B" }),
  ];
  const ts = [team("Alpha", "A"), team("Bravo", "A"), team("Charlie", "B"), team("Delta", "B")];
  const a = computeBasketballStandings(list, ts, {}, "A");
  assert.deepEqual(a.map((r) => r.team_name), ["Bravo", "Alpha"]);
  assert.equal(a[0].streak, "W2");
  assert.equal(a[0].last5, "LWW");
  assert.deepEqual(computeBasketballStandings(list, ts, {}, "B").map((r) => r.team_name), ["Charlie", "Delta"]);
  assert.equal(standingsScheme("Basketball").diffLabel, "+/-");
  assert.equal(standingsScheme("Basketball").draws, false);
  assert.equal(standingsScheme("Basketball", { allowTie: true }).draws, true);
  assert.equal(standingsScheme("Futsal").forLabel, "GF");
});

section("standings: cricket points and net run rate, a side bowled out counting its full overs", () => {
  const cteams = [team("Lions"), team("Tigers"), team("Bears")];
  const cgame = (a, b, ra, wa, oa, rb, wb, ob, extra = {}) => game(a, b, ra, rb, { wickets_a: wa, overs_a: oa, wickets_b: wb, overs_b: ob, ...extra });
  const ms = [
    cgame("Lions", "Tigers", 160, 4, 20, 120, 10, 15.3), // Tigers all out in 15.3: counted as 20 overs
    cgame("Tigers", "Bears", 140, 6, 20, 141, 3, 18.2),  // Bears chase in 18.2 overs
    cgame("Bears", "Lions", 150, 5, 20, 150, 8, 20, { winner_team_id: null }), // tie
  ];
  const t = computeCricketStandings(ms, cteams, { preset: "t20" });
  assert.deepEqual(t.map((r) => [r.team_name, r.points, r.won, r.lost, r.drawn]), [
    ["Lions", 3, 1, 0, 1], ["Bears", 3, 1, 0, 1], ["Tigers", 0, 0, 2, 0],
  ]);
  // Lions: 310 off 40 overs, 270 against in 40 (Tigers' 15.3 counted as 20): 7.75 - 6.75
  assert.equal(t[0].goal_diff, 1);
  // Bears: 291 off 38.2 overs, 290 against in 40
  assert.equal(t[1].goal_diff, Math.round(((291 / 230) * 6 - (290 / 240) * 6) * 1000) / 1000);
  assert.ok(t[0].goal_diff > t[1].goal_diff, "level on points: net run rate decides");
  const sc = standingsScheme("Cricket");
  assert.equal(sc.diffLabel, "NRR");
  assert.equal(diffText(sc, 1), "+1.000");
  assert.equal(diffText(sc, -0.4567), "-0.457");
  // a walkover counts for points but not for the run rate
  const wo = computeCricketStandings([...ms, game("Tigers", "Bears", null, null, { status: "walkover", winner_team_id: "Tigers" })], cteams, {});
  assert.equal(wo.find((r) => r.team_name === "Tigers").points, 2);
  assert.equal(wo.find((r) => r.team_name === "Bears").goal_diff, t[1].goal_diff);
});


section("standings: in a match cut to 8 overs, a side bowled out is charged 8 overs, not the tournament's 20", () => {
  const cteams = [team("Lions"), team("Tigers")];
  const m = game("Lions", "Tigers", 80, 60, { wickets_a: 3, overs_a: 8, wickets_b: 10, overs_b: 6.2 });
  const plain = computeCricketStandings([m], cteams, { preset: "t20" });
  // without the match's overs: Tigers charged 20 overs, 60 from 120 balls
  assert.equal(plain[0].goal_diff, Math.round(((80 / 48) * 6 - (60 / 120) * 6) * 1000) / 1000);
  const cut = computeCricketStandings([m], cteams, { preset: "t20" }, null, { [m.id]: { a: 48, b: 48 } });
  // with them: 60 from 48 balls
  assert.equal(cut[0].goal_diff, Math.round(((80 / 48) * 6 - (60 / 48) * 6) * 1000) / 1000);
  assert.equal(cut[0].goal_diff, 2.5);
  assert.equal(cut[1].goal_diff, -2.5);
});

section("cricket table: no result, configurable points, form and matches remaining", () => {
  const T = [team("Lions"), team("Tigers"), team("Bears"), team("Wolves")];
  const g = (a, b, ra, rb, extra = {}) => game(a, b, ra, rb, { wickets_a: 5, overs_a: 20, wickets_b: 5, overs_b: 20, ...extra });
  const abandoned = game("Lions", "Bears", null, null, { status: "cancelled" });
  const ms = [
    { ...g("Lions", "Tigers", 150, 140), starts_at: "2026-10-01T10:00:00Z" },
    { ...abandoned, starts_at: "2026-10-02T10:00:00Z" },                         // rained off after the start
    { ...game("Tigers", "Bears", null, null, { status: "completed" }), starts_at: "2026-10-03T10:00:00Z" }, // hand-entered no result
    { ...g("Lions", "Wolves", 120, 121), starts_at: "2026-10-04T10:00:00Z" },
    { ...game("Bears", "Wolves", null, null, { status: "scheduled" }) },         // still to play
    { ...game("Tigers", "Wolves", null, null, { status: "cancelled" }) },        // called off, never played: not a result
    { ...g("Lions", "Bears", 200, 100), stage: "knockout" },                     // knockouts never count
  ];
  const facts = { [abandoned.id]: { a: null, b: null, abandoned: true } };
  const t = computeCricketStandings(ms, T, { preset: "t20" }, null, facts);
  const lions = t.find((r) => r.team_name === "Lions"), bears = t.find((r) => r.team_name === "Bears");
  assert.deepEqual([lions.played, lions.won, lions.lost, lions.no_result, lions.points], [3, 1, 1, 1, 3], "win 2 + no result 1");
  assert.deepEqual(lions.form, ["W", "N", "L"], "form in date order, most recent last");
  assert.deepEqual([bears.played, bears.no_result, bears.points, bears.remaining, bears.max_points], [2, 2, 2, 1, 4]);
  assert.equal(lions.nrr_games, 2, "a no result has no run rate");
  // a competition's own points: 4 a win, 2 a tie or no result
  const own = computeCricketStandings(ms, T, { preset: "t20", table: { win: 4, tie: 2, noResult: 2, loss: 0 } }, null, facts);
  assert.equal(own.find((r) => r.team_name === "Lions").points, 6);
});

section("cricket table: tiebreakers in the competition's order", () => {
  const T = [team("Lions"), team("Tigers"), team("Bears")];
  const g = (a, b, ra, rb) => game(a, b, ra, rb, { wickets_a: 5, overs_a: 20, wickets_b: 5, overs_b: 20 });
  // Lions beat Tigers narrowly; Tigers thrash Bears; Bears beat Lions: all on 2 points
  const ms = [g("Lions", "Tigers", 141, 140), g("Tigers", "Bears", 200, 100), g("Bears", "Lions", 150, 149)];
  const byNrr = computeCricketStandings(ms, T, { preset: "t20" });
  assert.equal(byNrr[0].team_name, "Tigers", "net run rate first by default");
  const byRuns = computeCricketStandings(ms, T, { preset: "t20", table: { tiebreakers: ["runs_for"] } });
  assert.deepEqual(byRuns.map((r) => r.goals_for), [340, 290, 250]);
  // head to head: Lions and Tigers level on 2 points; Tigers' big win over X gives them the better run rate,
  // but Lions beat Tigers
  const four = ["Lions", "Tigers", "X", "Y"].map((n) => team(n));
  const ms2 = [g("Lions", "Tigers", 141, 140), g("Tigers", "X", 300, 100), g("Y", "Lions", 150, 140), g("Y", "Tigers", 150, 140)];
  const order = (tb) => computeCricketStandings(ms2, four, { preset: "t20", table: { tiebreakers: tb } }).map((r) => r.team_name);
  assert.deepEqual(order(["nrr"]), ["Y", "Tigers", "Lions", "X"], "on run rate, Tigers");
  assert.deepEqual(order(["head_to_head", "nrr"]), ["Y", "Lions", "Tigers", "X"], "on the game between them, Lions");
});

section("cricket table: qualification only when it is certain", () => {
  const T = ["A", "B", "C", "D"].map((n) => team(n));
  const g = (a, b, ra, rb, status = "completed") => game(a, b, status === "completed" ? ra : null, status === "completed" ? rb : null, { status, wickets_a: 5, overs_a: 20, wickets_b: 5, overs_b: 20 });
  const rules = { preset: "t20", table: { qualifiers: 2 } };
  // A has won 3 of 3; D has lost 3 of 3; B and C still to play each other
  const ms = [g("A", "B", 150, 100), g("A", "C", 150, 100), g("A", "D", 150, 100), g("B", "D", 150, 100), g("C", "D", 150, 100), g("B", "C", 0, 0, "scheduled")];
  const t = computeCricketStandings(ms, T, rules);
  const st = Object.fromEntries(t.map((r) => [r.team_name, r.status]));
  assert.deepEqual(st, { A: "qualified", B: "contention", C: "contention", D: "eliminated" });
  // once every match is played the table decides
  const done = computeCricketStandings([...ms.slice(0, 5), g("B", "C", 160, 120)], T, rules);
  assert.deepEqual(Object.fromEntries(done.map((r) => [r.team_name, r.status])), { A: "qualified", B: "qualified", C: "eliminated", D: "eliminated" });
  // without a qualifier count there is no status
  assert.equal(computeCricketStandings(ms, T, { preset: "t20" })[0].status, null);
});

section("cricket rules: the points table is validated when saved", () => {
  assert.deepEqual(E.resolveRules({ preset: "t20" }).table, { win: 2, tie: 1, noResult: 1, loss: 0, tiebreakers: ["nrr", "wins"], qualifiers: null });
  assert.equal(E.resolveRules({ preset: "t20", table: { win: 3, qualifiers: 4 } }).table.win, 3, "a partial table keeps the other defaults");
  assert.throws(() => E.resolveRules({ preset: "t20", table: { win: 0, loss: 1 } }), /more points than a loss/);
  assert.throws(() => E.resolveRules({ preset: "t20", table: { tiebreakers: ["coin_toss"] } }), /Unknown tiebreaker/);
});

section("cricket records: players from each match's lines, plus hand-entered totals", () => {
  const line = (contestId, playerId, raw) => ({ contestId, playerId, teamId: "t1", raw });
  const lines = [
    line("c1", "p1", { matches: 1, batInnings: 1, batRuns: 72, batBalls: 40, fours: 8, sixes: 3, dismissals: 1 }),
    line("c2", "p1", { matches: 1, batInnings: 1, batRuns: 72, batBalls: 35, notOuts: 1, fours: 6, sixes: 4 }),   // same score, not out: the better one
    line("c3", "p1", { matches: 1, batInnings: 1, batRuns: 104, batBalls: 60, dismissals: 1 }),
    line("c1", "p2", { matches: 1, bowlBalls: 24, bowlRuns: 18, wickets: 3, maidens: 1 }),
    line("c2", "p2", { matches: 1, bowlBalls: 24, bowlRuns: 30, wickets: 5 }),
    line("c3", "p2", { matches: 1, bowlBalls: 24, bowlRuns: 12, wickets: 5, catches: 2 }),
  ];
  const hand = [{ team_player_id: "p1", player_name: "Rajesh", team_id: "t1", team_name: "Kings", runs: 30, balls_faced: 20, fours: 2, sixes: 1, wickets: 0, overs_bowled: 0, catches: 1, mom_count: 1 }];
  const ps = cricketPlayers(lines, (id) => ({ name: id === "p1" ? "Rajesh" : "Bikash", team: "Kings" }), hand);
  const raj = ps.find((p) => p.id === "p1"), bik = ps.find((p) => p.id === "p2");
  assert.deepEqual(raj.highest, { runs: 104, notOut: false });
  assert.deepEqual([raj.fifties, raj.hundreds, raj.runs, raj.innings, raj.notOuts], [2, 1, 278, 3, 1], "hand-entered runs add to the total, not to the innings");
  assert.equal(raj.average, 139, "278 runs over 2 dismissals");
  assert.equal(raj.mom, 1);
  assert.deepEqual(bik.best, { wickets: 5, runs: 12 }, "most wickets, then fewest runs");
  assert.deepEqual([bik.wickets, bik.threeFors, bik.fiveFors, bik.maidens, bik.economy, bik.bowlAverage], [13, 1, 2, 1, 5, 4.62]);
  assert.equal(bik.average, null, "never out: no batting average");
});

section("cricket records: team totals, chases and margins from the fixtures", () => {
  const T = [team("Lions"), team("Tigers"), team("Bears")];
  const g = (a, b, ra, wa, oa, rb, wb, ob, extra = {}) => game(a, b, ra, rb, { wickets_a: wa, overs_a: oa, wickets_b: wb, overs_b: ob, ...extra });
  const m1 = g("Lions", "Tigers", 180, 4, 20, 181, 6, 19.2, { toss_winner_team_id: "Tigers", toss_decision: "bowl" }); // Tigers chase 181 with 4 wickets left
  const m2 = g("Tigers", "Bears", 150, 8, 20, 90, 10, 14.3);                                                        // Tigers win by 60 runs
  const m3 = g("Bears", "Lions", 95, 2, 9.4, 94, 10, 18.1, { id: "scored" });                                         // Bears chase 95 early: never their "lowest"
  const r = cricketTeams([m1, m2, m3], T, { preset: "t20" }, { scored: { a: 120, b: 120, first: "b" } });
  const tig = r.teams.find((t) => t.teamId === "Tigers"), bears = r.teams.find((t) => t.teamId === "Bears");
  assert.deepEqual([tig.won, tig.biggestWinWickets, tig.biggestWinRuns, tig.bestChase.runs], [2, 4, 60, 181]);
  assert.equal(bears.lowest.runs, 90, "the 95 was a successful chase that stopped early");
  assert.equal(chasingSide(m1, 10), "b", "Tigers won the toss and bowled: they chased");
  assert.equal(chasingSide(m3, 10, { scored: { first: "b" } }), "a", "the scored match says who batted first");
  assert.equal(chasingSide(m2, 10), "b", "a 60-run win: a chase never ends more than 6 ahead, so the winner batted first");
  const close = g("Lions", "Bears", 150, 6, 20, 147, 7, 20);
  assert.equal(chasingSide(close, 10), null, "3 runs apart, same overs, no toss: not guessed");
});
