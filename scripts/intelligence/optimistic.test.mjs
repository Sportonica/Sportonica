import assert from "node:assert/strict";
import { basketballEngine as B } from "../../src/lib/intelligence/sports/basketball.ts";
import { cricketEngine as C } from "../../src/lib/intelligence/sports/cricket.ts";
import { summarize } from "../../src/lib/intelligence/core/engine.ts";
import { withQueued } from "../../src/lib/intelligence/optimistic.ts";
import { makeContext, openMatch, section } from "./harness.mjs";

// a contest as the scorer's screen holds it, from a match in the harness
const view = (m, sport) => ({
  id: "c1", tournamentId: "t1", matchId: "m1", sport, label: null, status: m.env.status, lastSeq: m.events.length,
  summary: summarize(m.engine, m.env, m.ctx, m.rules), context: m.ctx, rules: m.rules, state: m.env.sport,
  startedAt: m.env.startedAt, completedAt: m.env.completedAt, updatedAt: "2026-10-08T00:00:00Z",
});
const q = (type, payload = {}) => ({ type, payload, clientId: crypto.randomUUID(), occurredAt: "2026-10-08T10:00:00.000Z" });

section("instant scoring: taps on their way show at once, as the server will score them", () => {
  const m = openMatch(B, makeContext("basketball", 4), { preset: "3x3" });
  m.push("MATCH_START"); m.push("PERIOD_START");
  const c = view(m, "basketball");
  const shown = withQueued(c, [q("SHOT_MADE", { side: "a", player: "a1", points: 2 }), q("SHOT_MADE", { side: "b", player: "b1", points: 1 })]);
  assert.deepEqual(shown.state.score, { a: 2, b: 1 });
  assert.equal(shown.lastSeq, c.lastSeq + 2);
  assert.equal(shown.summary.view.score.a, "2", "the score card reads the preview too");
  assert.deepEqual(c.state.score, { a: 0, b: 0 }, "the server's copy is untouched");
  // the same taps sent for real give the same match
  m.push("SHOT_MADE", { side: "a", player: "a1", points: 2 }); m.push("SHOT_MADE", { side: "b", player: "b1", points: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(shown.state)).score, m.env.sport.score);
  assert.equal(withQueued(c, []), c, "nothing queued: the server's state as it is");
});

section("instant scoring: a tap the rules refuse is not shown, nor anything after it", () => {
  const m = openMatch(B, makeContext("basketball", 4), { preset: "3x3" });
  m.push("MATCH_START"); m.push("PERIOD_START");
  const shown = withQueued(view(m, "basketball"), [
    q("SHOT_MADE", { side: "a", player: "a1", points: 1 }),
    q("SHOT_MADE", { side: "a", player: "a1", points: 3 }), // no 3 in 3x3
    q("SHOT_MADE", { side: "b", player: "b1", points: 1 }),
  ]);
  assert.deepEqual(shown.state.score, { a: 1, b: 0 });
});

section("instant scoring: cricket balls show at once", () => {
  const m = openMatch(C, makeContext("cricket", 8), { preset: "custom", oversPerInnings: 10, wicketsPerInnings: 7 });
  m.push("MATCH_START"); m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  const shown = withQueued(view(m, "cricket"), [
    q("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 4 }),
    q("DELIVERY", { striker: "a1", nonStriker: "a2", bowler: "b1", runsBat: 1 }),
  ]);
  const inn = shown.state.innings[0];
  assert.deepEqual([inn.runs, inn.balls, inn.striker], [5, 2, "a2"]);
});
