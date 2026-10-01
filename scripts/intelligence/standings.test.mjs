import assert from "node:assert/strict";
import { computeBasketballStandings, standingsScheme } from "../../src/lib/tournaments/standings.ts";
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
