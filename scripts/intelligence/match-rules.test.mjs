import assert from "node:assert/strict";
import { cricketEngine as C } from "../../src/lib/intelligence/sports/cricket.ts";
import { reconstruct } from "../../src/lib/intelligence/core/engine.ts";
import { makeContext, openMatch, section } from "./harness.mjs";

// setContestRules replays the log under the new rules and refuses when an
// event that was accepted no longer fits. These are the engine halves of it.
const errorsUnder = (m, input) => reconstruct(C, m.ctx, C.resolveRules(input), m.events).issues.filter((i) => i.severity === "error");

section("match rules: an 8-a-side innings set up with 10 wickets", () => {
  const ctx = makeContext("cricket", 8);
  const m = openMatch(C, ctx, { preset: "custom", oversPerInnings: 10 });
  m.push("MATCH_START");
  m.push("TOSS", { winner: "a", decision: "bat" });
  m.push("INNINGS_START", { batting: "a", striker: "a1", nonStriker: "a2" });
  // three wickets in three balls
  let striker = "a1";
  for (let i = 0; i < 3; i++) {
    m.push("DELIVERY", { striker, nonStriker: "a2", bowler: "b1", runsBat: 0, wicket: { type: "bowled" } });
    striker = `a${i + 3}`;
    m.push("NEW_BATTER", { player: striker });
  }
  assert.equal(m.env.sport.innings[0].wickets, 3);
  // fixing it to 7 wickets fits what was played
  assert.deepEqual(errorsUnder(m, { preset: "custom", oversPerInnings: 10, wicketsPerInnings: 7 }), []);
  // 2 wickets would have ended the innings before the third ball and its new batter
  assert.ok(errorsUnder(m, { preset: "custom", oversPerInnings: 10, wicketsPerInnings: 2 }).length, "fewer wickets than already fell is refused");
  // the score is rebuilt under the new rules
  const rebuilt = reconstruct(C, ctx, C.resolveRules({ preset: "custom", oversPerInnings: 6, wicketsPerInnings: 7 }), m.events);
  assert.equal(rebuilt.envelope.sport.innings[0].maxBalls, 36, "6 overs a side after the change");
});
