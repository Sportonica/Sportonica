// Plain assertion checks for src/lib/tournaments/teamBulk.ts (alphabetical
// team order + the bulk Mark paid / Delete runner). Like the identity checks,
// this needs no test runner:
//   npm run test:bulk

import assert from "node:assert/strict";
import {
  compareTeamNames,
  sortTeamsByName,
  canMarkWalkinPaid,
  runOneByOne,
  describeBulkResult,
  SIGNED_OUT_MESSAGE,
} from "../src/lib/tournaments/teamBulk.ts";

const team = (id, name) => ({ id, name });

// ── alphabetical order ──
// The real team list from the platform console, in the order it was showing.
const shown = [
  "WE PLAY SPORTS", "YARSHA FC", "Insight Vision SS/College", "FUTSAL FLAMES", "Budhanilkantha-8",
  "NEW YOUTH CLUB", "PATHIVARA SPORTING CLUB", "Futsal Arena", "BROTHERHOOD UNITED CLUB",
  "SUNSARI DEAF FC (Dharan)", "MNFC", "HIMALAYAN FC (BLUE)",
].map((n, i) => team(`t${i}`, n));
assert.deepEqual(sortTeamsByName(shown).map((t) => t.name), [
  "BROTHERHOOD UNITED CLUB", "Budhanilkantha-8", "Futsal Arena", "FUTSAL FLAMES", "HIMALAYAN FC (BLUE)",
  "Insight Vision SS/College", "MNFC", "NEW YOUTH CLUB", "PATHIVARA SPORTING CLUB",
  "SUNSARI DEAF FC (Dharan)", "WE PLAY SPORTS", "YARSHA FC",
], "real team list sorts A to Z regardless of letter case");

assert.deepEqual(
  sortTeamsByName([team("a", "Team 10"), team("b", "Team 2"), team("c", "Team 1")]).map((t) => t.name),
  ["Team 1", "Team 2", "Team 10"], "numbers sort by value, not digit by digit");
assert.deepEqual(
  sortTeamsByName([team("a", "zebra"), team("b", "Alpha"), team("c", "beta")]).map((t) => t.name),
  ["Alpha", "beta", "zebra"], "lower case does not sort after upper case");
assert.deepEqual(
  sortTeamsByName([team("b", "Same"), team("a", "same")]).map((t) => t.id),
  ["a", "b"], "identical names fall back to id so the order is stable");

const input = [team("2", "B"), team("1", "A")];
const before = JSON.stringify(input);
sortTeamsByName(input);
assert.equal(JSON.stringify(input), before, "sorting never mutates the original list");
assert.deepEqual(sortTeamsByName([]), [], "empty list");
assert.equal(compareTeamNames("a", "a"), 0);
assert.ok(compareTeamNames("Alpha", "beta") < 0);

// ── who can be marked paid ──
assert.equal(canMarkWalkinPaid({ is_walkin: true, status: "payment_pending" }), true);
assert.equal(canMarkWalkinPaid({ is_walkin: true, status: "confirmed" }), false, "already confirmed");
assert.equal(canMarkWalkinPaid({ is_walkin: false, status: "payment_pending" }), false, "online teams pay through Payments");

// ── runner: strictly one at a time, in order ──
{
  let running = 0, peak = 0;
  const order = [];
  const progress = [];
  const r = await runOneByOne(["a", "b", "c", "d"], async (id) => {
    running++; peak = Math.max(peak, running);
    await new Promise((res) => setTimeout(res, 5));
    order.push(id); running--;
    return null;
  }, { onProgress: (n, total) => progress.push(`${n}/${total}`) });
  assert.equal(peak, 1, "never runs two at once");
  assert.deepEqual(order, ["a", "b", "c", "d"]);
  assert.deepEqual(progress, ["1/4", "2/4", "3/4", "4/4"]);
  assert.deepEqual(r, { done: ["a", "b", "c", "d"], failed: [], notAttempted: [] });
}

// ── runner: a failure or a throw does not stop the rest ──
{
  const r = await runOneByOne(["a", "b", "c", "d"], async (id) => {
    if (id === "b") return "This team has already played a match, so it can't be deleted.";
    if (id === "c") throw new Error("network");
    return null;
  });
  assert.deepEqual(r.done, ["a", "d"]);
  assert.deepEqual(r.failed, [
    { id: "b", message: "This team has already played a match, so it can't be deleted." },
    { id: "c", message: "Something went wrong." },
  ]);
  assert.deepEqual(r.notAttempted, []);
}

// ── runner: a fatal message stops the run and reports what was skipped ──
{
  const calls = [];
  const r = await runOneByOne(["a", "b", "c", "d"], async (id) => {
    calls.push(id);
    return id === "b" ? SIGNED_OUT_MESSAGE : null;
  }, { stopOn: (m) => m === SIGNED_OUT_MESSAGE });
  assert.deepEqual(calls, ["a", "b"], "stops calling the server once signed out");
  assert.deepEqual(r.done, ["a"]);
  assert.deepEqual(r.failed, [{ id: "b", message: SIGNED_OUT_MESSAGE }]);
  assert.deepEqual(r.notAttempted, ["c", "d"]);
}

// ── runner: nothing to do ──
assert.deepEqual(await runOneByOne([], async () => null), { done: [], failed: [], notAttempted: [] });

// ── result messages ──
const nameOf = (id) => ({ a: "Alpha FC", b: "Bravo FC", c: "Charlie FC", d: "Delta FC", e: "Echo FC" })[id] ?? id;
assert.deepEqual(
  describeBulkResult("deleted", { done: ["a"], failed: [], notAttempted: [] }, nameOf),
  { ok: "1 team deleted.", problem: null });
assert.deepEqual(
  describeBulkResult("marked as paid", { done: ["a", "b", "c"], failed: [], notAttempted: [] }, nameOf),
  { ok: "3 teams marked as paid.", problem: null });
assert.deepEqual(
  describeBulkResult("deleted", { done: ["a", "b"], failed: [{ id: "c", message: "It has already played a match." }], notAttempted: [] }, nameOf),
  { ok: "2 teams deleted.", problem: "1 team couldn't be processed: Charlie FC (It has already played a match)." });
assert.deepEqual(
  describeBulkResult("deleted", { done: [], failed: ["a", "b", "c", "d", "e"].map((id) => ({ id, message: "No." })), notAttempted: [] }, nameOf),
  { ok: null, problem: "5 teams couldn't be processed: Alpha FC (No); Bravo FC (No); Charlie FC (No); and 2 more." });
assert.deepEqual(
  describeBulkResult("deleted", { done: ["a"], failed: [{ id: "b", message: SIGNED_OUT_MESSAGE }], notAttempted: ["c", "d"] }, nameOf).problem,
  "1 team couldn't be processed: Bravo FC (You're signed out. Sign in again to continue). 2 teams weren't attempted, so try again.");

console.log("team bulk helpers: all checks passed");
