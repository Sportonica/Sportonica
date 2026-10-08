// What the scorer's screen shows while taps are still being sent.

import { recordEvent, summarize, type MatchEnvelope } from "./core/engine";
import { getEngine } from "./registry";
import type { ContestView } from "./types";

export interface QueuedEvent { type: string; payload: Record<string, unknown>; clientId: string; occurredAt: string }

/**
 * The contest with the taps still on their way applied on top, by the same
 * engine the server runs, so a tap shows on the screen at once instead of
 * after the round trip. The server stays the judge: its answer replaces
 * this, and a tap it refuses is taken off again (the queue is cleared).
 */
export function withQueued(c: ContestView, queue: QueuedEvent[]): ContestView {
  if (!queue.length || !c.state) return c;
  try {
    const engine = getEngine(c.sport);
    const rules = engine.resolveRules(c.rules);
    let env: MatchEnvelope = {
      status: c.status, sport: c.state, result: c.summary?.result ?? null, startedAt: c.startedAt, completedAt: c.completedAt,
      restarts: 0, statusReason: c.summary?.statusReason ?? null,
    };
    let applied = 0;
    for (const q of queue) {
      try { env = recordEvent(engine, env, { id: q.clientId, seq: c.lastSeq + applied + 1, type: q.type, payload: q.payload, occurredAt: q.occurredAt }, c.context, rules); }
      catch { break; } // the server will refuse it too, and say why
      applied += 1;
    }
    if (!applied) return c;
    return { ...c, status: env.status, state: env.sport, summary: summarize(engine, env, c.context, rules), lastSeq: c.lastSeq + applied };
  } catch {
    return c; // never let the preview stop the scorer: show the server's state
  }
}

