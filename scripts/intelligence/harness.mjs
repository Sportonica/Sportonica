// A tiny in-memory stand-in for the database side of scoring, so the
// engines can be driven exactly as the server action drives them:
// one event at a time against the running state, corrections appended,
// and a full rebuild from the log to compare against.

import assert from "node:assert/strict";
import { EngineError, applyCorrection, newEnvelope, reconstruct, recordEvent, summarize } from "../../src/lib/intelligence/core/engine.ts";

export function makeContext(sport, playersPerSide = 5) {
  const side = (key, name) => ({
    teamId: `team-${key}`, name,
    players: Array.from({ length: playersPerSide }, (_, i) => ({ id: `${key}${i + 1}`, name: `${name} ${i + 1}`, number: i + 1, userId: `user-${key}${i + 1}` })),
  });
  return { sport, sides: { a: side("a", "Alpha"), b: side("b", "Bravo") } };
}

export function openMatch(engine, ctx, rulesInput = {}) {
  const rules = engine.resolveRules(rulesInput);
  const m = {
    engine, ctx, rules, events: [],
    env: newEnvelope(engine, ctx, rules),

    /** Record an event; throws EngineError if the rules forbid it. */
    push(type, payload = {}, extra = {}) {
      const seq = m.events.length + 1;
      const ev = { id: `e${seq}`, seq, type, payload, occurredAt: new Date(Date.UTC(2026, 8, 30, 10, 0, seq)).toISOString(), clientId: `c${seq}`, ...extra };
      m.env = recordEvent(engine, m.env, ev, ctx, rules);
      m.events.push(ev);
      return ev;
    },
    /** The reason an event is refused, or null if it was accepted (and recorded). */
    attempt(type, payload = {}) {
      try { m.push(type, payload); return null; } catch (e) { if (e instanceof EngineError) return e.message; throw e; }
    },
    /** Assert an event is refused and leaves the match untouched. */
    refuses(type, payload, pattern, label) {
      const before = JSON.stringify(m.env), count = m.events.length;
      const why = m.attempt(type, payload);
      assert.ok(why, `${label}: expected the event to be refused`);
      if (pattern) assert.match(why, pattern, `${label}: refused for the wrong reason (${why})`);
      assert.equal(JSON.stringify(m.env), before, `${label}: a refused event must not change the match`);
      assert.equal(m.events.length, count, `${label}: a refused event must not be stored`);
    },
    correct(kind, targetId, reason, type, payload) {
      const seq = m.events.length + 1;
      const ev = {
        id: `e${seq}`, seq, occurredAt: new Date(Date.UTC(2026, 8, 30, 11, 0, seq)).toISOString(), clientId: `c${seq}`, recordedBy: "scorer-2", reason,
        ...(kind === "void" ? { type: "CORRECTION_VOID", payload: {}, voidsEventId: targetId } : { type, payload, replacesEventId: targetId }),
      };
      const rebuilt = applyCorrection(engine, ctx, rules, m.events, ev);
      m.events.push(ev);
      m.env = rebuilt.envelope;
      return ev;
    },
    rebuild() { return reconstruct(engine, ctx, rules, m.events); },
    summary() { return summarize(engine, m.env, ctx, rules); },
    stats() { return engine.calculateStatistics(m.env.sport, ctx, rules); },
    analytics() { return engine.calculateAdvancedAnalytics(m.env.sport, ctx, rules); },
    /** Reconstruction must reproduce the live state exactly, with no errors. */
    assertReconstructs(label) {
      const r = m.rebuild();
      assert.deepEqual(r.issues.filter((i) => i.severity === "error"), [], `${label}: rebuilding from events reported errors`);
      assert.deepEqual(JSON.parse(JSON.stringify(r.envelope)), JSON.parse(JSON.stringify(m.env)), `${label}: rebuilt state differs from the live state`);
      const again = m.rebuild();
      assert.deepEqual(again.envelope, r.envelope, `${label}: rebuilding twice gave different results`);
      const shuffled = reconstruct(engine, ctx, rules, [...m.events].reverse());
      assert.deepEqual(shuffled.envelope, r.envelope, `${label}: the order events are loaded in must not matter`);
    },
  };
  return m;
}

export const cell = (tables, tableKey, rowId, col) => {
  const t = tables.find((x) => x.key === tableKey);
  assert.ok(t, `no table "${tableKey}"`);
  const r = t.rows.find((x) => x.id === rowId);
  assert.ok(r, `no row "${rowId}" in "${tableKey}"`);
  return r.values[col];
};

export const card = (analytics, label) => analytics.cards.find((c) => c.label === label)?.value;

let passed = 0;
export function section(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
export const count = () => passed;
