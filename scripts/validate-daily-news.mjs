// Plain assertion checks for src/lib/push/dailyNews.ts (no database):
//   npm run test:daily-news

import assert from "node:assert/strict";
import { composeDailyNews, ktmDate, ktmDayStart, resultLine } from "../src/lib/push/dailyNews.ts";

// 18:15 Kathmandu on 6 Nov 2026, when the cron runs.
const NOW = new Date("2026-11-06T12:30:00Z");
const today = (hhmm) => new Date(Date.parse(`2026-11-06T${hhmm}:00+05:45`)).toISOString();
const tomorrow = (hhmm) => new Date(Date.parse(`2026-11-07T${hhmm}:00+05:45`)).toISOString();

const T = (o = {}) => ({ id: "t1", slug: "bungtang-volleyball", name: "Bungtang Volleyball", status: "live", organizer_name: "Ward 5",
  starts_at: today("09:00"), registration_closes_at: null, ...o });
const M = (o = {}) => ({ tournament_id: "t1", stage: "group", round_label: "Group A", team_a_id: "a", team_b_id: "b", next_match_id: null,
  starts_at: today("10:00"), updated_at: today("11:00"), status: "completed", score_a: 3, score_b: 1, wickets_a: null, wickets_b: null,
  score_a_pens: null, score_b_pens: null, winner_team_id: "a", ...o });
const names = new Map([["a", "Eagles"], ["b", "Tigers"], ["c", "Hawks"], ["d", "Lions"]]);
const run = (tournaments, matches) => composeDailyNews({ tournaments, matches, teamNames: names }, NOW);

// Kathmandu day maths
assert.equal(ktmDate("2026-11-06T18:14:00Z"), "2026-11-06");
assert.equal(ktmDate("2026-11-06T18:15:00Z"), "2026-11-07");
assert.equal(ktmDayStart(NOW).toISOString(), "2026-11-05T18:15:00.000Z");

// result lines
assert.equal(resultLine(M(), names), "Eagles beat Tigers 3–1");
assert.equal(resultLine(M({ winner_team_id: "b", score_a: 1, score_b: 3 }), names), "Tigers beat Eagles 3–1");
assert.equal(resultLine(M({ winner_team_id: null, score_a: 2, score_b: 2 }), names), "Eagles 2–2 Tigers");
assert.equal(resultLine(M({ score_a: 1, score_b: 1, score_a_pens: 4, score_b_pens: 3 }), names), "Eagles beat Tigers 1–1 (4–3 on penalties)");
assert.equal(resultLine(M({ status: "walkover", score_a: null, score_b: null }), names), "Eagles got a walkover against Tigers");
assert.equal(resultLine(M({ score_a: 156, wickets_a: 4, score_b: 120, wickets_b: 9 }), names), "Eagles beat Tigers 156/4–120/9");
assert.equal(resultLine(M({ team_b_id: "zz" }), names), null);

// today's results + tomorrow
let msg = run([T()], [
  M(), M({ team_a_id: "c", team_b_id: "d", winner_team_id: "d", score_a: 0, score_b: 3, starts_at: today("11:00") }),
  M({ team_a_id: "a", team_b_id: "c", starts_at: today("12:00"), score_a: 3, score_b: 2 }),
  M({ status: "scheduled", starts_at: tomorrow("09:15"), score_a: null, score_b: null, winner_team_id: null }),
  M({ status: "scheduled", starts_at: tomorrow("10:30"), score_a: null, score_b: null, winner_team_id: null }),
]);
assert.deepEqual(msg, { title: "Today's results: Bungtang Volleyball",
  body: "Eagles beat Tigers 3–1 · Lions beat Hawks 3–0 · +1 more. Tomorrow: 2 matches from 9:15 am.", url: "/tournaments/bungtang-volleyball" });

// only tomorrow's fixtures; tournament starts tomorrow
msg = run([T({ starts_at: tomorrow("09:15"), status: "registration_closed" })], [
  M({ status: "scheduled", starts_at: tomorrow("09:15"), score_a: null, score_b: null, winner_team_id: null }),
]);
assert.deepEqual(msg, { title: "Starts tomorrow: Bungtang Volleyball", body: "1 match from 9:15 am. First up: Eagles vs Tigers.", url: "/tournaments/bungtang-volleyball" });

// a final today beats everything
msg = run([T({ status: "completed" })], [M(), M({ stage: "knockout", round_label: "Final", winner_team_id: "b", score_a: 1, score_b: 3, starts_at: today("15:00") })]);
assert.deepEqual(msg, { title: "Champions: Tigers", body: "Tigers won the Bungtang Volleyball. Final: Tigers beat Eagles 3–1.", url: "/tournaments/bungtang-volleyball" });
// a semi-final is not the final
msg = run([T()], [M({ stage: "knockout", round_label: "Semi Final" })]);
assert.equal(msg.title, "Today's results: Bungtang Volleyball");

// busiest tournament wins
msg = run([T(), T({ id: "t2", slug: null, name: "Kalikot Cup" })], [
  M(), M({ tournament_id: "t2" }), M({ tournament_id: "t2", starts_at: today("12:00") }),
]);
assert.equal(msg.url, "/tournaments/t2");

// test and sample tournaments are ignored
assert.equal(run([T({ name: "TEST Volleyball Cup" })], [M()]), null);
assert.equal(run([T({ organizer_name: "Sportonica (sample)" })], [M()]), null);

// yesterday's results are old news
assert.equal(run([T()], [M({ starts_at: "2026-11-05T05:00:00Z" })]), null);

// registration closing soon
msg = run([T({ status: "registration_open", registration_closes_at: tomorrow("17:00") })], []);
assert.deepEqual(msg, { title: "Last call: Bungtang Volleyball", body: "Registration closes tomorrow. Get your team in.", url: "/tournaments/bungtang-volleyball" });
assert.equal(run([T({ status: "registration_open", registration_closes_at: "2026-11-20T00:00:00Z" })], []), null);

// nothing on
assert.equal(run([T()], []), null);

console.log("daily news: all checks passed");
