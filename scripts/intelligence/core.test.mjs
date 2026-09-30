// Core: lifecycle, duplicates, gaps, corrections, determinism.
import assert from "node:assert/strict";
import { basketballEngine } from "../../src/lib/intelligence/sports/basketball.ts";
import { effectiveEvents, reconstruct } from "../../src/lib/intelligence/core/engine.ts";
import { formatDuration, parseDuration, ratio, pct } from "../../src/lib/intelligence/core/util.ts";
import { sumRaw } from "../../src/lib/intelligence/aggregate.ts";
import { makeContext, openMatch, section } from "./harness.mjs";

const E = basketballEngine;
const ctx = makeContext("basketball");
const two = { side: "a", player: "a1", points: 2 };

section("core: scoring is refused until the match and a period have started", () => {
  const m = openMatch(E, ctx);
  m.refuses("SHOT_MADE", two, /Start the match/, "before start");
  m.push("MATCH_START");
  m.refuses("SHOT_MADE", two, /Start the period/, "before period");
  m.refuses("MATCH_START", {}, /already started/, "double start");
  m.refuses("NOT_A_REAL_EVENT", {}, /not a Basketball event/, "unknown type");
});

section("core: pause and resume", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push("SHOT_MADE", two);
  m.push("MATCH_PAUSE", { reason: "Floodlight failure" });
  assert.equal(m.env.status, "paused");
  assert.equal(m.env.statusReason, "Floodlight failure");
  m.refuses("SHOT_MADE", two, /paused/, "scoring while paused");
  m.refuses("MATCH_PAUSE", {}, /live/, "pausing twice");
  m.push("MATCH_RESUME");
  m.push("SHOT_MADE", two);
  assert.equal(m.env.sport.score.a, 4);
  m.assertReconstructs("pause/resume");
});

section("core: postponed, then played; cancelled is terminal", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_POSTPONE", { reason: "Rain" });
  assert.equal(m.env.status, "postponed");
  m.refuses("MATCH_POSTPONE", {}, /not started/, "postponing twice");
  m.push("MATCH_START");
  assert.equal(m.env.status, "live");
  m.refuses("MATCH_CANCEL", {}, /Abandon/, "cancel after start");

  const c = openMatch(E, ctx);
  c.push("MATCH_CANCEL", { reason: "Venue unavailable" });
  assert.equal(c.env.status, "cancelled");
  c.refuses("MATCH_START", {}, /already started/, "start after cancel");
});

section("core: abandoned match keeps its statistics and has no result", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push("SHOT_MADE", two);
  m.push("MATCH_ABANDON", { reason: "Storm" });
  assert.equal(m.env.status, "abandoned");
  assert.deepEqual(m.env.result, { outcome: "no_result", winner: null, method: "abandoned", margin: null });
  assert.equal(m.env.sport.score.a, 2, "points scored before the abandonment are kept");
  m.refuses("SHOT_MADE", two, /over/, "scoring after abandonment");
});

section("core: walkover before the start, forfeit during play", () => {
  const w = openMatch(E, ctx);
  w.push("MATCH_FORFEIT", { side: "b" });
  assert.equal(w.env.status, "completed");
  assert.equal(w.env.result.winner, "a");
  assert.equal(w.env.result.method, "walkover");

  const f = openMatch(E, ctx);
  f.push("MATCH_START"); f.push("PERIOD_START"); f.push("SHOT_MADE", { side: "b", player: "b1", points: 3 });
  f.push("MATCH_FORFEIT", { side: "b" });
  assert.equal(f.env.result.winner, "a", "the side that did not forfeit wins even when behind");
  assert.equal(f.env.result.method, "forfeit");
  f.refuses("MATCH_FORFEIT", { side: "a" }, /already over/, "second forfeit");
});

section("core: a restart clears the score but keeps the history", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push("SHOT_MADE", two);
  m.push("MATCH_RESTART", { reason: "Wrong teams entered" });
  assert.equal(m.env.sport.score.a, 0);
  assert.equal(m.env.sport.period, 0);
  assert.equal(m.env.restarts, 1);
  assert.equal(m.events.length, 4, "earlier events stay in the log");
  m.assertReconstructs("restart");
});

section("core: an incomplete match cannot be completed", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  m.refuses("MATCH_COMPLETE", {}, /still in progress/, "period open");
  m.push("PERIOD_END");
  m.refuses("MATCH_COMPLETE", {}, /1 of 4 periods/, "periods remaining");
});

section("core: a resubmitted event is applied once", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push("SHOT_MADE", two);
  // the same tap delivered twice (double submission, or an offline retry)
  const dup = { ...m.events[2], id: "e-dup", seq: 4 };
  const r = reconstruct(E, ctx, m.rules, [...m.events, dup]);
  assert.equal(r.envelope.sport.score.a, 2, "the duplicate must not score again");
  assert.ok(r.issues.some((i) => i.code === "DUPLICATE_EVENT" && i.severity === "warning"));
});

section("core: a missing event is detected", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START"); m.push("SHOT_MADE", two); m.push("SHOT_MADE", two);
  const withHole = m.events.filter((e) => e.seq !== 3);
  const r = reconstruct(E, ctx, m.rules, withHole);
  assert.ok(r.issues.some((i) => i.code === "MISSING_EVENT" && i.seq === 3), "the gap at sequence 3 is reported");
  assert.equal(r.envelope.sport.score.a, 2);
});

section("core: an impossible stored event is skipped and reported, not applied", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const bad = { id: "bad", seq: 3, type: "SHOT_MADE", payload: { side: "a", player: "a1", points: 7 }, occurredAt: "2026-09-30T10:00:03.000Z", clientId: "bad" };
  const r = reconstruct(E, ctx, m.rules, [...m.events, bad]);
  assert.equal(r.envelope.sport.score.a, 0);
  assert.ok(r.issues.some((i) => i.code === "INVALID_EVENT" && i.eventId === "bad"));
});

section("core: void reverses an event; the original stays in the log", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const three = m.push("SHOT_MADE", { side: "a", player: "a1", points: 3 });
  m.push("SHOT_MADE", { side: "b", player: "b1", points: 2 });
  assert.equal(m.env.sport.score.a, 3);
  const fix = m.correct("void", three.id, "Shot was after the buzzer");
  assert.equal(m.env.sport.score.a, 0);
  assert.equal(m.env.sport.score.b, 2);
  assert.equal(m.events.length, 5, "nothing is deleted");
  assert.equal(m.events.find((e) => e.id === three.id).payload.points, 3, "the original event is unchanged");
  assert.equal(fix.reason, "Shot was after the buzzer");
  assert.equal(fix.recordedBy, "scorer-2");
  assert.deepEqual(effectiveEvents(m.events).superseded, [three.id]);
});

section("core: replacement: +3 becomes +2, in the original position", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const three = m.push("SHOT_MADE", { side: "a", player: "a1", points: 3 });
  m.push("SHOT_MADE", { side: "b", player: "b1", points: 2 });
  m.correct("replace", three.id, "Foot was on the line", "SHOT_MADE", { side: "a", player: "a1", points: 2 });
  assert.equal(m.env.sport.score.a, 2);
  assert.deepEqual(m.env.sport.scoring.map((s) => `${s.side}${s.pts}`), ["a2", "b2"], "the corrected basket still comes before the later one");
  assert.equal(m.env.sport.team.a.tpm ?? 0, 0);
});

section("core: corrections need a reason, a real target, and cannot be stacked on a dead event", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START"); m.push("PERIOD_START");
  const shot = m.push("SHOT_MADE", two);
  assert.throws(() => m.correct("void", shot.id, "  "), /needs a reason/);
  assert.throws(() => m.correct("void", "nope", "typo"), /not in this match/);
  m.correct("void", shot.id, "Entered for the wrong team");
  assert.throws(() => m.correct("void", shot.id, "again"), /already been corrected/);
  assert.equal(m.events.length, 4, "refused corrections are not stored");
});

section("core: a correction that would make later events impossible is refused", () => {
  const m = openMatch(E, ctx);
  m.push("MATCH_START");
  const level = [];
  for (let q = 1; q <= 4; q++) {
    m.push("PERIOD_START");
    if (q === 4) { level.push(m.push("SHOT_MADE", two)); m.push("SHOT_MADE", { side: "b", player: "b1", points: 2 }); }
    m.push("PERIOD_END");
  }
  m.push("PERIOD_START"); // overtime, allowed because it is 2-2
  assert.throws(() => m.correct("void", level[0].id, "Basket disallowed"), /not possible.*Overtime is only played when the score is level/s);
  assert.equal(m.env.sport.score.a, 2, "the refused correction left the match alone");
});

section("core: safe arithmetic never divides by zero", () => {
  assert.equal(ratio(5, 0), null);
  assert.equal(pct(0, 0), null);
  assert.equal(pct(1, 4), 25);
  assert.equal(ratio(null, 3), null);
});

section("core: times are durations, not decimals", () => {
  assert.equal(parseDuration("01:02.45"), 62450);
  assert.equal(parseDuration("1:02.45"), 62450);
  assert.equal(parseDuration("52.34"), 52340);
  assert.equal(parseDuration("52.3"), 52300);
  assert.equal(parseDuration("1:01:02.45"), 3662450);
  assert.equal(parseDuration("1:75.00"), null, "75 seconds is not a valid seconds field");
  assert.equal(parseDuration("fast"), null);
  assert.equal(formatDuration(62450), "1:02.45");
  assert.equal(formatDuration(52340), "52.34");
  assert.equal(formatDuration(3662450), "1:01:02.45");
  assert.notEqual(parseDuration("01:02.45"), 1.0245 * 1000);
});

section("core: historical sums keep extremes as extremes", () => {
  assert.deepEqual(
    sumRaw([{ pts: 10, longestStreak: 4, fastestMs: 53000, place: 2 }, { pts: 7, longestStreak: 9, fastestMs: 52340, place: 1 }]),
    { pts: 17, longestStreak: 9, fastestMs: 52340 });
});
