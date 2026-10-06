// Dry run of a basketball box score save (see saveBasketballBoxScore):
// the events it will write, checked in memory first so a refusal never
// leaves half a box score stored.

import { applyCorrection, recordEvent, type MatchEnvelope } from "./core/engine";
import { CORRECTION_VOID, type MatchContext, type Side, type SportIntelligenceEngine, type StoredEvent } from "./core/types";

export type BoxPayload = Record<string, unknown>;

/**
 * Throws EngineError when the save is impossible. `current` holds the box
 * score event in force for each side (null: none yet); `completeId` the
 * MATCH_COMPLETE in force, reversed first when a finished game changes
 * (one side at a time could pass through a level score).
 */
export function checkBoxScoreSave(
  engine: SportIntelligenceEngine, ctx: MatchContext, rules: unknown,
  state: MatchEnvelope, stored: StoredEvent[], lastSeq: number,
  current: Record<Side, string | null>, completeId: string | null, changed: Side[], payload: Record<Side, BoxPayload>, reason: string,
): void {
  let events = stored;
  let seq = lastSeq;
  let env = state;
  const at = new Date().toISOString();
  const add = (ev: StoredEvent, correction: boolean) => {
    env = correction ? applyCorrection(engine, ctx, rules, events, ev).envelope : recordEvent(engine, env, ev, ctx, rules);
    events = [...events, ev];
  };
  if (env.status === "scheduled" || env.status === "postponed") add({ id: "plan-start", seq: ++seq, type: "MATCH_START", payload: {}, occurredAt: at }, false);
  if (changed.length && env.status === "completed" && completeId) {
    add({ id: "plan-void", seq: ++seq, type: CORRECTION_VOID, payload: {}, occurredAt: at, voidsEventId: completeId, reason }, true);
  }
  for (const side of changed) {
    const was = current[side];
    add(was
      ? { id: `plan-${side}`, seq: ++seq, type: "BOX_SCORE", payload: payload[side], occurredAt: at, replacesEventId: was, reason }
      : { id: `plan-${side}`, seq: ++seq, type: "BOX_SCORE", payload: payload[side], occurredAt: at }, !!was);
  }
  if (env.status !== "completed") add({ id: "plan-done", seq: ++seq, type: "MATCH_COMPLETE", payload: {}, occurredAt: at }, false);
}
