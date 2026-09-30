import assert from "node:assert/strict";
import { swimmingEngine as E, rankTimes, swimEventKey, swimEventName, swimPerformance } from "../../src/lib/intelligence/sports/swimming.ts";
import { aggregate } from "../../src/lib/intelligence/aggregate.ts";
import { RulesError } from "../../src/lib/intelligence/core/types.ts";
import { formatDuration, parseDuration } from "../../src/lib/intelligence/core/util.ts";
import { openMatch, section, cell, card } from "./harness.mjs";

const ctx = { sport: "swimming", sides: null };
const entry = (lane, name) => ({ lane, entryId: `team-${lane}`, name, teamId: `team-${lane}`, teamPlayerId: `tp-${lane}`, userId: `user-${lane}` });
const FREE_100 = { distance: 100, stroke: "freestyle", course: 50, round: "heat", heat: 3, entries: [entry(3, "Asha"), entry(4, "Bina"), entry(5, "Chand")] };
const t = parseDuration;

function heat() {
  const m = openMatch(E, ctx, FREE_100);
  m.push("MATCH_START");
  m.push("RACE_START");
  m.push("REACTION", { lane: 4, timeMs: 650 });
  m.push("SPLIT", { lane: 4, distance: 50, timeMs: t("25.10") });
  m.push("SPLIT", { lane: 3, distance: 50, timeMs: t("25.50"), strokeRate: 48 });
  m.push("SPLIT", { lane: 5, distance: 50, timeMs: t("26.00") });
  m.push("RACE_FINISH", { lane: 4, timeMs: t("52.34") });
  m.push("RACE_FINISH", { lane: 3, timeMs: 52345 });          // 52.345: equal to the hundredth
  m.push("RACE_FINISH", { lane: 5, timeMs: t("53.00") });
  return m;
}

section("swimming: a time is a duration in milliseconds", () => {
  assert.equal(t("01:02.45"), 62450);
  assert.equal(formatDuration(62450), "1:02.45");
  assert.notEqual(t("01:02.45"), 1024.5);
  assert.equal(t("52.34"), 52340);
  assert.ok(t("59.99") < t("1:00.00"), "59.99 is faster than 1:00.00 (as decimals 59.99 > 1.00)");
  assert.equal(swimEventName(E.resolveRules(FREE_100)), "100m Freestyle");
  assert.equal(swimEventName({ distance: 200, stroke: "medley", relay: false, relayLegs: 4 }), "200m Individual Medley");
  assert.equal(swimEventName({ distance: 400, stroke: "freestyle", relay: true, relayLegs: 4 }), "4x100m Freestyle Relay");
  assert.equal(swimEventKey(E.resolveRules(FREE_100)), "100-freestyle-50");
});

section("swimming: heat, finish, ranking with a tie", () => {
  const m = heat();
  const v = m.summary().view;
  assert.equal(v.kind, "race");
  assert.equal(v.periodLabel, "100m Freestyle, Heat 3");
  assert.deepEqual(v.lanes.map((l) => [l.lane, l.name, l.time, l.rank]), [[3, "Asha", "52.34", 1], [4, "Bina", "52.34", 1], [5, "Chand", "53.00", 3]], "equal to the hundredth share first; the next place is third");
  assert.deepEqual(m.summary().lines, ["100m Freestyle", "Heat 3", "Lane 3: Asha, 52.34", "Lane 4: Bina, 52.34", "Lane 5: Chand, 53.00"]);
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.outcome, "ranked");
  assert.equal(m.env.result.margin, "Asha and Bina won in 52.34");
  assert.equal(E.mirrorScore(m.env.sport, ctx, m.rules), null, "a race has no score to mirror");
  m.assertReconstructs("heat");
});

section("swimming: splits, pace and gaps", () => {
  const m = heat();
  const p = m.stats().players;
  assert.deepEqual([cell(p, "results", "4", "final"), cell(p, "results", "4", "reaction"), cell(p, "results", "4", "place")], [52340, 650, 1]);
  assert.equal(cell(p, "results", "4", "pace"), 52340, "100 m race: pace per 100 m is the final time");
  assert.equal(cell(p, "results", "4", "avgSplit"), 26170);
  assert.equal(cell(p, "results", "5", "gap"), 660);
  assert.equal(cell(p, "results", "4", "gap"), 0);
  assert.equal(cell(p, "results", "3", "strokeRate"), 48);
  assert.equal(cell(p, "results", "4", "strokeRate"), null, "stroke rate was not recorded for lane 4");
  assert.equal(cell(p, "results", "3", "reaction"), null);
  assert.deepEqual([cell(p, "splits", "4", "d50"), cell(p, "splits", "4", "d100")], [25100, 27240], "lap times, not cumulative times");
  const an = m.analytics();
  assert.equal(card(an, "Winning time"), "52.34");
  assert.equal(card(an, "Winning margin"), "0.00");
  assert.equal(card(an, "Fastest reaction"), "0.65");
  assert.deepEqual(an.charts.find((c) => c.key === "splits").series.find((s) => s.name === "Chand").values, [26000, 27000]);
});

section("swimming: invalid times are refused", () => {
  const m = openMatch(E, ctx, FREE_100);
  m.push("MATCH_START");
  m.refuses("SPLIT", { lane: 4, distance: 50, timeMs: 25000 }, /Start the race/, "split before the start");
  m.push("RACE_START");
  m.refuses("RACE_START", {}, /already started/, "second start");
  m.refuses("SPLIT", { lane: 1, distance: 50, timeMs: 25000 }, /no entry in that lane/, "empty lane");
  m.refuses("SPLIT", { lane: 4, distance: 50, timeMs: 25.1 }, /whole number of milliseconds/, "a decimal time");
  m.refuses("SPLIT", { lane: 4, distance: 50, timeMs: -5 }, /greater than zero/, "negative time");
  m.refuses("SPLIT", { lane: 4, distance: 75, timeMs: 40000 }, /every 50 m/, "split between walls");
  m.refuses("SPLIT", { lane: 4, distance: 100, timeMs: 52000 }, /finish, not a split/, "split at the finish");
  m.refuses("SPLIT", { lane: 4, distance: 50, timeMs: 9000 }, /too fast for 50 m/, "9 seconds for 50 m");
  m.refuses("REACTION", { lane: 4, timeMs: 9000 }, /plausible reaction/, "nine second reaction");
  m.push("SPLIT", { lane: 4, distance: 50, timeMs: 25100 });
  m.refuses("SPLIT", { lane: 4, distance: 50, timeMs: 25200 }, /already been recorded/, "same split twice");
  m.refuses("RACE_FINISH", { lane: 4, timeMs: 25000 }, /earlier than the last split/, "finish before the split");
  m.refuses("RACE_FINISH", { lane: 3, timeMs: 20000 }, /too fast for 100 m/, "20 seconds for 100 m");
  m.push("RACE_FINISH", { lane: 4, timeMs: 52340 });
  m.refuses("RACE_FINISH", { lane: 4, timeMs: 52400 }, /already finished/, "finishing twice");
  m.refuses("MATCH_COMPLETE", {}, /Lanes 3, 5 still have no result/, "lanes still swimming");
});

section("swimming: disqualification, did not start, did not finish", () => {
  const m = openMatch(E, ctx, FREE_100);
  m.push("MATCH_START");
  m.push("DNS", { lane: 5 });
  m.push("RACE_START");
  m.refuses("SPLIT", { lane: 5, distance: 50, timeMs: 26000 }, /not in the race/, "time for a swimmer who did not start");
  m.refuses("DISQUALIFICATION", { lane: 5, reason: "x" }, /did not start cannot be disqualified/, "DQ of a DNS");
  m.push("RACE_FINISH", { lane: 4, timeMs: 52340 });
  m.push("DNF", { lane: 3 });
  m.refuses("DISQUALIFICATION", { lane: 4 }, /Give the reason/, "DQ without a reason");
  m.push("DISQUALIFICATION", { lane: 4, reason: "Illegal turn" });
  const v = m.summary().view;
  assert.deepEqual(v.lanes.map((l) => [l.lane, l.status, l.rank]), [[3, "DNF", null], [4, "DSQ", null], [5, "DNS", null]], "a disqualified swimmer is not ranked even with a time");
  assert.equal(v.lanes.find((l) => l.lane === 4).detail, "Illegal turn");
  m.push("MATCH_COMPLETE");
  assert.equal(m.env.result.margin, "No finishers");
  const raw = m.stats().lines.find((l) => l.subjectKey === "tp-4").raw;
  assert.deepEqual([raw.disqualified, raw.finishes ?? 0, raw.fastestMs ?? null], [1, 0, null], "a disqualified swim is not a best time");
});

section("swimming: false starts", () => {
  const one = openMatch(E, ctx, FREE_100);
  one.push("MATCH_START"); one.push("RACE_START");
  one.push("FALSE_START", { lane: 3 });
  assert.equal(one.env.sport.lanes[3].status, "dq", "one-start rule: disqualified");
  assert.equal(one.env.sport.started, true, "the race carries on");
  one.refuses("SPLIT", { lane: 3, distance: 50, timeMs: 25000 }, /disqualified/, "time for the disqualified lane");

  const two = openMatch(E, ctx, { ...FREE_100, falseStartRule: "two_start" });
  two.push("MATCH_START"); two.push("RACE_START");
  two.push("SPLIT", { lane: 4, distance: 50, timeMs: 25000 });
  two.push("FALSE_START", { lane: 3, recall: true });
  assert.equal(two.env.sport.lanes[3].status, "entered", "two-start rule: the first false start is a warning");
  assert.equal(two.env.sport.started, false, "the start is recalled");
  assert.deepEqual(two.env.sport.lanes[4].splits, [], "nothing swum before the recall counts");
  two.push("RACE_START");
  two.push("FALSE_START", { lane: 5 });
  assert.equal(two.env.sport.lanes[5].status, "dq", "the second false start disqualifies whoever commits it");
  two.assertReconstructs("false starts");
});

section("swimming: relay teams, order and leg times", () => {
  const team = (lane, name, swimmers) => ({ lane, entryId: `team-${lane}`, name, teamId: `team-${lane}`, swimmers: swimmers.map((n, i) => ({ name: n, teamPlayerId: `${name}-${i + 1}` })) });
  const rules = { distance: 200, stroke: "freestyle", course: 50, relay: true, relayLegs: 4, round: "final", entries: [team(4, "Sharks", ["Ann", "Bea", "Cat", "Dee"])] };
  assert.throws(() => E.resolveRules({ ...rules, entries: [team(4, "Sharks", ["Ann", "Bea"])] }), RulesError);
  const m = openMatch(E, ctx, rules);
  m.push("MATCH_START"); m.push("RACE_START");
  m.push("SPLIT", { lane: 4, distance: 50, timeMs: 26000 });
  m.push("SPLIT", { lane: 4, distance: 100, timeMs: 51500 });
  m.push("SPLIT", { lane: 4, distance: 150, timeMs: 78000 });
  m.push("RACE_FINISH", { lane: 4, timeMs: 103200 });
  assert.equal(m.summary().view.periodLabel, "4x50m Freestyle Relay, Final");
  const p = m.stats().players;
  assert.deepEqual(["leg1", "leg2", "leg3", "leg4"].map((k) => cell(p, "relay", "4", k)), ["Ann 26.00", "Bea 25.50", "Cat 26.50", "Dee 25.20"]);
  assert.equal(cell(p, "results", "4", "final"), 103200);
  assert.equal(formatDuration(cell(p, "results", "4", "final")), "1:43.20");
  const lines = m.stats().lines;
  assert.deepEqual(lines.find((l) => l.subject === "team").raw.fastestMs, 103200);
  assert.equal(lines.find((l) => l.subject === "team").eventKey, "200-freestyle-50-relay");
  const bea = lines.find((l) => l.subjectKey === "Sharks-2");
  assert.deepEqual([bea.raw.fastestMs, bea.eventKey], [25500, "50-freestyle-50-relayleg"], "a relay leg is kept apart from a flat-start 50");
});

section("swimming: personal best, season best and improvement", () => {
  const history = [{ timeMs: 53000, date: "2025-05-01" }, { timeMs: 52800, date: "2026-03-01" }, { timeMs: 52500, date: "2026-08-01" }];
  const pb = swimPerformance({ timeMs: 52340, date: "2026-09-30" }, history);
  assert.deepEqual(pb, { personalBestMs: 52500, seasonBestMs: 52500, isPersonalBest: true, isSeasonBest: true, diffFromPersonalBestMs: -160, improvementMs: 160, improvementPct: 0.3 });
  const slower = swimPerformance({ timeMs: 52900, date: "2026-09-30" }, history);
  assert.deepEqual([slower.isPersonalBest, slower.isSeasonBest, slower.diffFromPersonalBestMs, slower.improvementMs, slower.improvementPct], [false, false, 400, -400, -0.76]);
  const newSeason = swimPerformance({ timeMs: 52900, date: "2027-01-15" }, history);
  assert.deepEqual([newSeason.isPersonalBest, newSeason.isSeasonBest, newSeason.seasonBestMs], [false, true, null], "first swim of a new season is the season best, not a personal best");
  const first = swimPerformance({ timeMs: 60000, date: "2026-09-30" }, []);
  assert.deepEqual([first.isPersonalBest, first.personalBestMs, first.improvementMs, first.improvementPct], [true, null, null, null], "no history: nothing to compare against");
  const later = swimPerformance({ timeMs: 52000, date: "2026-01-01" }, history);
  assert.equal(later.personalBestMs, 53000, "only swims before this one count");
});

section("swimming: ranking across heats", () => {
  const all = rankTimes([{ id: "h1-4", timeMs: 52340 }, { id: "h2-4", timeMs: 51990 }, { id: "h1-3", timeMs: 52345 }, { id: "h2-5", timeMs: 54000 }], 10);
  assert.deepEqual(all.map((r) => [r.id, r.rank]), [["h2-4", 1], ["h1-4", 2], ["h1-3", 2], ["h2-5", 4]]);
});

section("swimming: rules are validated", () => {
  assert.throws(() => E.resolveRules({ stroke: "freestyle", entries: [entry(1, "A")] }), /distance is required/);
  assert.throws(() => E.resolveRules({ ...FREE_100, distance: 75 }), /whole number of pool lengths/);
  assert.throws(() => E.resolveRules({ ...FREE_100, entries: [entry(4, "A"), entry(4, "B")] }), /lane 4 is assigned twice/);
  assert.throws(() => E.resolveRules({ ...FREE_100, entries: [entry(9, "A")] }), /lane from 1 to 8/);
  assert.throws(() => E.resolveRules({ ...FREE_100, entries: [] }), /at least one entry/);
  assert.equal(E.resolveRules({ ...FREE_100, course: 25 }).course, 25);
  const m = openMatch(E, ctx, FREE_100);
  m.refuses("MATCH_FORFEIT", { side: "a" }, /no sides to forfeit/, "forfeiting a race");
});

section("swimming: correcting a mistimed finish", () => {
  const m = heat();
  const wrong = m.events.find((e) => e.type === "RACE_FINISH" && e.payload.lane === 5);
  m.correct("replace", wrong.id, "Touchpad time was 52.10, stopwatch misread", "RACE_FINISH", { lane: 5, timeMs: t("52.10") });
  assert.deepEqual(m.summary().view.lanes.map((l) => [l.lane, l.rank]), [[5, 1], [3, 2], [4, 2]]);
  assert.throws(() => m.correct("replace", m.events.find((e) => e.type === "RACE_FINISH" && e.payload.lane === 4).id, "typo", "RACE_FINISH", { lane: 4, timeMs: 20000 }), /not possible.*earlier than the last split/);
});

section("swimming: best and average time across swims", () => {
  const a = heat(), b = heat();
  const wrong = b.events.find((e) => e.type === "RACE_FINISH" && e.payload.lane === 4);
  b.correct("replace", wrong.id, "test", "RACE_FINISH", { lane: 4, timeMs: 53000 });
  const line = (m) => m.stats().lines.find((l) => l.subjectKey === "tp-4").raw;
  const agg = aggregate(E, "player", [line(a), line(b)]);
  assert.deepEqual([agg.values.swims, agg.values.fastestMs, agg.values.averageMs], [2, 52340, 52670], "the best time is a minimum, the average is over finished swims");
  assert.equal(aggregate(E, "player", [{ swims: 1, disqualified: 1 }]).values.averageMs, null);
});
