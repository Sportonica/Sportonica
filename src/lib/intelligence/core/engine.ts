// ================================================================
// The sport-neutral half of scoring: match lifecycle, corrections,
// duplicate / gap detection and deterministic reconstruction.
//
// reconstruct() is a pure function of (rules, context, events), so the
// same log always rebuilds the same match. A stored score is only ever
// a cache of what this returns.
// ================================================================

import {
  CORRECTION_VOID, LIFECYCLE_EVENTS, isSide, otherSide,
  type ContestStatus, type EngineEvent, type Issue, type MatchContext, type MatchResult,
  type ScoreView, type Side, type SportIntelligenceEngine, type StoredEvent,
} from "./types";
import { sideName } from "./util";

export interface MatchEnvelope<S = unknown> {
  status: ContestStatus;
  sport: S;
  result: MatchResult | null;
  startedAt: string | null;
  completedAt: string | null;
  restarts: number;
  // why the match is not running, for the status banner
  statusReason: string | null;
}

export class EngineError extends Error {}

const LIFECYCLE = new Set<string>(LIFECYCLE_EVENTS);

export function newEnvelope<R, S>(engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R): MatchEnvelope<S> {
  return {
    status: "scheduled", sport: engine.initializeMatch(ctx, rules), result: null,
    startedAt: null, completedAt: null, restarts: 0, statusReason: null,
  };
}

const reasonOf = (ev: EngineEvent): string | null =>
  typeof ev.payload.reason === "string" && ev.payload.reason.trim() ? ev.payload.reason.trim() : null;

/** A result named by the organiser on MATCH_COMPLETE, or why it cannot stand. */
function declaredResult(ev: EngineEvent, ctx: MatchContext): MatchResult | string {
  if (!ctx.sides) return "A race cannot be ended with a declared result";
  if (!reasonOf(ev)) return "Say why the match is ending before it is decided";
  const r = ev.payload.result as { outcome?: unknown; winner?: unknown; margin?: unknown } | null;
  if (!r || typeof r !== "object") return "Say how the match ended";
  const margin = typeof r.margin === "string" && r.margin.trim() ? r.margin.trim().slice(0, 80) : "match ended early";
  if (r.outcome === "tie") return { outcome: "tie", winner: null, method: "played", margin };
  if (r.outcome !== "win") return "The result is a win or a tie";
  if (!isSide(r.winner)) return "Say which side won";
  return { outcome: "win", winner: r.winner, method: "played", margin };
}

/**
 * Apply one event to a draft envelope. Returns null when applied, or the
 * reason it is impossible (the draft is then left untouched).
 */
export function applyEvent<R, S>(
  engine: SportIntelligenceEngine<R, S>, env: MatchEnvelope<S>, ev: EngineEvent, ctx: MatchContext, rules: R,
): string | null {
  const st = env.status;

  if (LIFECYCLE.has(ev.type)) {
    switch (ev.type) {
      case "MATCH_START":
        if (st !== "scheduled" && st !== "postponed") return "The match has already started";
        env.status = "live"; env.startedAt = ev.occurredAt; env.statusReason = null;
        return null;
      case "MATCH_PAUSE":
        if (st !== "live") return "Only a live match can be paused";
        env.status = "paused"; env.statusReason = reasonOf(ev);
        return null;
      case "MATCH_RESUME":
        if (st !== "paused") return "The match is not paused";
        env.status = "live"; env.statusReason = null;
        return null;
      case "MATCH_POSTPONE":
        if (st !== "scheduled") return "Only a match that has not started can be postponed";
        env.status = "postponed"; env.statusReason = reasonOf(ev);
        return null;
      case "MATCH_CANCEL":
        if (st !== "scheduled" && st !== "postponed") return "A match that has started cannot be cancelled. Abandon it instead";
        env.status = "cancelled"; env.statusReason = reasonOf(ev);
        return null;
      case "MATCH_ABANDON":
        if (st !== "live" && st !== "paused") return "Only a match in progress can be abandoned";
        env.status = "abandoned"; env.statusReason = reasonOf(ev); env.completedAt = ev.occurredAt;
        env.result = { outcome: "no_result", winner: null, method: "abandoned", margin: null };
        return null;
      case "MATCH_FORFEIT": {
        if (!ctx.sides) return "A race has no sides to forfeit";
        const side = ev.payload.side;
        if (!isSide(side)) return "Say which side forfeits";
        if (st === "completed" || st === "cancelled" || st === "abandoned") return "The match is already over";
        const started = st === "live" || st === "paused";
        env.status = "completed"; env.completedAt = ev.occurredAt; env.statusReason = reasonOf(ev);
        env.result = {
          outcome: "win", winner: otherSide(side), method: started ? "forfeit" : "walkover",
          margin: `${sideName(ctx, side)} ${started ? "forfeited" : "did not play"}`,
        };
        return null;
      }
      case "MATCH_RESTART":
        if (st !== "live" && st !== "paused") return "Only a match in progress can be restarted";
        env.sport = engine.initializeMatch(ctx, rules);
        env.status = "live"; env.restarts += 1; env.statusReason = null; env.result = null;
        return null;
      // a finished match taken back into play to fix or add events; completing it again sends the new result on
      case "MATCH_REOPEN":
        if (st !== "completed") return "Only a completed match can be reopened";
        env.status = "live"; env.completedAt = null; env.result = null; env.statusReason = reasonOf(ev);
        return null;
      case "MATCH_COMPLETE": {
        if (st !== "live" && st !== "paused") return "Only a match in progress can be completed";
        // the organiser ends it before the score decides it (rain, light, time up) and names the result
        if (ev.payload.result !== undefined) {
          const declared = declaredResult(ev, ctx);
          if (typeof declared === "string") return declared;
          env.status = "completed"; env.completedAt = ev.occurredAt; env.statusReason = reasonOf(ev);
          env.result = declared;
          return null;
        }
        const why = engine.validateMatchCompletion(env.sport, ctx, rules);
        if (why) return why;
        env.status = "completed"; env.completedAt = ev.occurredAt; env.statusReason = null;
        env.result = engine.finalizeMatch(env.sport, ctx, rules);
        return null;
      }
    }
  }

  if (!engine.eventTypes.includes(ev.type)) return `"${ev.type}" is not a ${engine.label} event`;
  if (st !== "live") {
    return st === "paused" ? "The match is paused. Resume it to keep scoring"
      : st === "scheduled" || st === "postponed" ? "Start the match before scoring"
      : "The match is over";
  }
  const why = engine.validateEvent(env.sport, ev, ctx, rules);
  if (why) return why;
  env.sport = engine.updateScore(env.sport, ev, ctx, rules);
  return null;
}

/** Validate + apply on a copy. Throws EngineError when the event is impossible. */
export function recordEvent<R, S>(
  engine: SportIntelligenceEngine<R, S>, env: MatchEnvelope<S>, ev: EngineEvent, ctx: MatchContext, rules: R,
): MatchEnvelope<S> {
  const draft = structuredClone(env);
  const why = applyEvent(engine, draft, ev, ctx, rules);
  if (why) throw new EngineError(why);
  return draft;
}

export interface Reconstruction<S = unknown> {
  envelope: MatchEnvelope<S>;
  issues: Issue[];
  // events that actually changed the match, in replay order
  applied: EngineEvent[];
  // ids cancelled by a void or superseded by a replacement
  superseded: string[];
  // seq -> where the event fell in the match, for sports that number their events
  labels: Record<number, string>;
  lastSeq: number;
}

/**
 * Turn the raw log into the ordered list of events that count:
 * duplicates removed, voids and replacements resolved, and a
 * replacement placed where the event it replaces was.
 */
export function effectiveEvents(events: StoredEvent[]): { list: StoredEvent[]; issues: Issue[]; superseded: string[]; positions: Map<string, number> } {
  const issues: Issue[] = [];
  const bySeq = [...events].sort((x, y) => x.seq - y.seq);

  // duplicates: a resubmitted event (same client id) or a repeated seq
  const seenClient = new Set<string>();
  const seenSeq = new Set<number>();
  const unique: StoredEvent[] = [];
  for (const ev of bySeq) {
    if (seenSeq.has(ev.seq)) {
      issues.push({ severity: "error", code: "DUPLICATE_SEQUENCE", message: `Two events share sequence ${ev.seq}`, seq: ev.seq, eventId: ev.id });
      continue;
    }
    if (ev.clientId && seenClient.has(ev.clientId)) {
      issues.push({ severity: "warning", code: "DUPLICATE_EVENT", message: `Event ${ev.seq} is a resubmission and was ignored`, seq: ev.seq, eventId: ev.id });
      continue;
    }
    seenSeq.add(ev.seq);
    if (ev.clientId) seenClient.add(ev.clientId);
    unique.push(ev);
  }

  // gaps: seq is a per-contest counter, so a hole means a lost event
  let expected = unique.length ? Math.min(1, unique[0].seq) : 1;
  for (const ev of unique) {
    if (ev.seq > expected) {
      issues.push({ severity: "error", code: "MISSING_EVENT", message: `Events ${expected} to ${ev.seq - 1} are missing from the log`, seq: expected });
    }
    expected = ev.seq + 1;
  }

  const byId = new Map(unique.map((e) => [e.id, e]));
  // Newest first: a correction only counts if it was not itself corrected.
  const dead = new Set<string>();
  for (let i = unique.length - 1; i >= 0; i--) {
    const ev = unique[i];
    if (dead.has(ev.id)) continue;
    const target = ev.voidsEventId ?? ev.replacesEventId ?? null;
    if (!target) continue;
    const t = byId.get(target);
    if (!t) {
      issues.push({ severity: "error", code: "CORRECTION_TARGET_MISSING", message: `Event ${ev.seq} corrects an event that is not in the log`, seq: ev.seq, eventId: ev.id });
      dead.add(ev.id);
    } else if (t.seq >= ev.seq) {
      issues.push({ severity: "error", code: "CORRECTION_OUT_OF_ORDER", message: `Event ${ev.seq} corrects a later event`, seq: ev.seq, eventId: ev.id });
      dead.add(ev.id);
    } else {
      dead.add(target);
      // Replacing a replacement replaces the whole chain: the original must
      // not come back because the edit that replaced it is itself replaced.
      // (A void of a replacement does bring it back: that is undoing the edit.)
      if (ev.replacesEventId) {
        for (let x = t, hops = 0; x.replacesEventId && hops < 1000; hops++) {
          dead.add(x.replacesEventId);
          const next = byId.get(x.replacesEventId);
          if (!next) break;
          x = next;
        }
      }
    }
  }

  // A replacement sits where the original sat; chains resolve to the root.
  // An event recorded late (a missed ball) names the event it goes before
  // (payload.insertBefore) and sits just ahead of it.
  const position = (ev: StoredEvent, depth = 0): number => {
    let cur = ev;
    for (let hops = 0; cur.replacesEventId && hops < 1000; hops++) {
      const t = byId.get(cur.replacesEventId);
      if (!t) break;
      cur = t;
    }
    const before = byId.get(insertBeforeOf(cur) ?? "");
    if (before && before.seq < cur.seq && depth < 1000) return position(before, depth + 1) - 0.5 ** (depth + 1);
    return cur.seq;
  };

  const list = unique
    .filter((e) => !dead.has(e.id) && e.type !== CORRECTION_VOID && !e.voidsEventId)
    .map((e) => ({ e, pos: position(e) }))
    .sort((x, y) => x.pos - y.pos || x.e.seq - y.e.seq)
    .map((x) => x.e);

  const positions = new Map(unique.map((e) => [e.id, position(e)]));
  return { list, issues, superseded: [...dead], positions };
}

/** The event a late-recorded event goes before, if it names one. */
export function insertBeforeOf(ev: StoredEvent): string | null {
  const v = (ev.payload as { insertBefore?: unknown } | undefined)?.insertBefore;
  return typeof v === "string" && v ? v : null;
}

/**
 * A missed event recorded in its place: it goes before an event still in
 * force, and must not leave the match impossible from there on.
 */
export function applyInsertion<R, S>(
  engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[], ev: StoredEvent,
): Reconstruction<S> {
  const targetId = insertBeforeOf(ev);
  if (!targetId) throw new EngineError("Say which event this goes before");
  const target = events.find((e) => e.id === targetId);
  if (!target) throw new EngineError("The event it goes before is not in this match");
  const { superseded } = effectiveEvents(events);
  if (superseded.includes(targetId) || target.type === CORRECTION_VOID) throw new EngineError("That event has been corrected. Insert before the corrected one");
  const before = new Set(reconstruct(engine, ctx, rules, events).issues.filter((i) => i.severity === "error").map(errorKey));
  const after = reconstruct(engine, ctx, rules, [...events, ev]);
  const introduced = after.issues.find((i) => i.severity === "error" && !before.has(errorKey(i)));
  if (introduced) throw new EngineError(`This ball cannot go there: ${introduced.message}`);
  return after;
}

/** recalculateScore: rebuild the whole match from its events. */
export function reconstruct<R, S>(
  engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[],
): Reconstruction<S> {
  const { list, issues, superseded } = effectiveEvents(events);
  const env = newEnvelope(engine, ctx, rules);
  const applied: EngineEvent[] = [];
  const labels: Record<number, string> = {};

  for (const stored of list) {
    const ev: EngineEvent = { id: stored.id, seq: stored.seq, type: stored.type, payload: stored.payload ?? {}, occurredAt: stored.occurredAt };
    const label = engine.eventLabel?.(env.sport, ev, rules);
    const why = applyEvent(engine, env, ev, ctx, rules);
    if (!why && label) labels[ev.seq] = label;
    if (why) {
      issues.push({ severity: "error", code: "INVALID_EVENT", message: `Event ${stored.seq} (${stored.type}) was skipped: ${why}`, seq: stored.seq, eventId: stored.id });
    } else {
      applied.push(ev);
    }
  }

  issues.push(...engine.validateScore(env.sport, ctx, rules));
  const lastSeq = events.reduce((m, e) => Math.max(m, e.seq), 0);
  return { envelope: env, issues, applied, superseded, labels, lastSeq };
}

// ── the read model a contest row caches and Realtime delivers ───────

export interface ContestSummary {
  status: ContestStatus;
  statusReason: string | null;
  view: ScoreView;
  lines: string[];
  result: MatchResult | null;
  resultText: string | null;
}

export function resultText(result: MatchResult | null, ctx: MatchContext): string | null {
  if (!result) return null;
  const who = (s: Side | null) => (s ? sideName(ctx, s) : "");
  switch (result.outcome) {
    case "win": return `${who(result.winner)} won${result.margin ? ` (${result.margin})` : ""}`;
    case "tie": return "Match tied";
    case "draw": return "Match drawn";
    case "no_result": return "No result";
    case "ranked": return result.margin ?? "Results final";
  }
}

export function summarize<R, S>(
  engine: SportIntelligenceEngine<R, S>, env: MatchEnvelope<S>, ctx: MatchContext, rules: R,
): ContestSummary {
  return {
    status: env.status,
    statusReason: env.statusReason,
    view: engine.getCurrentState(env.sport, ctx, rules),
    lines: engine.getMatchSummary(env.sport, ctx, rules),
    result: env.result,
    resultText: resultText(env.result, ctx),
  };
}

export function describe<R, S>(engine: SportIntelligenceEngine<R, S>, ev: EngineEvent, ctx: MatchContext, rules: R): string {
  switch (ev.type) {
    case "MATCH_START": return "Match started";
    case "MATCH_PAUSE": return `Match paused${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_RESUME": return "Match resumed";
    case "MATCH_POSTPONE": return `Match postponed${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_CANCEL": return `Match cancelled${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_ABANDON": return `Match abandoned${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_FORFEIT": return isSide(ev.payload.side) ? `${sideName(ctx, ev.payload.side)} forfeited` : "Forfeit";
    case "MATCH_RESTART": return `Match restarted${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_REOPEN": return `Match reopened${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    case "MATCH_COMPLETE": {
      const r = ev.payload.result as { outcome?: unknown; winner?: unknown } | undefined;
      if (!r) return "Match completed";
      const what = r.outcome === "tie" ? "declared a tie" : isSide(r.winner) ? `${sideName(ctx, r.winner)} declared the winner` : "result declared";
      return `Match ended early, ${what}${reasonOf(ev) ? `: ${reasonOf(ev)}` : ""}`;
    }
    case CORRECTION_VOID: return "Correction: event reversed";
    default: return engine.describeEvent(ev, ctx, rules);
  }
}

const errorKey = (i: Issue): string => `${i.code}|${i.seq ?? ""}|${i.message}`;

/**
 * Rebuild the match with one more correction (a void or a replacement)
 * appended. Refused when it would make the log worse: a correction may
 * not leave any later event impossible ("remove the basket that forced
 * overtime, but keep the overtime").
 */
export function applyCorrection<R, S>(
  engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[], correction: StoredEvent,
): Reconstruction<S> {
  const targetId = correction.voidsEventId ?? correction.replacesEventId;
  if (!targetId) throw new EngineError("A correction must name the event it corrects");
  if (!correction.reason || !correction.reason.trim()) throw new EngineError("A correction needs a reason");
  const target = events.find((e) => e.id === targetId);
  if (!target) throw new EngineError("The event being corrected is not in this match");
  if (target.voidsEventId || target.type === CORRECTION_VOID) throw new EngineError("A reversal cannot itself be corrected. Record the event again instead");
  const { superseded } = effectiveEvents(events);
  if (superseded.includes(targetId)) throw new EngineError("That event has already been corrected");

  const before = new Set(reconstruct(engine, ctx, rules, events).issues.filter((i) => i.severity === "error").map(errorKey));
  const after = reconstruct(engine, ctx, rules, [...events, correction]);
  const introduced = after.issues.find((i) => i.severity === "error" && !before.has(errorKey(i)));
  if (introduced) throw new EngineError(`This correction is not possible: ${introduced.message}`);
  return after;
}

/**
 * Several corrections as one (a player renamed across the match, the
 * bowler of an over, a wicket taken away with the batter who came in for
 * it): each must replace or reverse an event that is still in force, and
 * together they must not leave the match impossible.
 */
export function applyCorrections<R, S>(
  engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[], corrections: StoredEvent[],
): Reconstruction<S> {
  if (!corrections.length) throw new EngineError("Nothing to change");
  const { superseded } = effectiveEvents(events);
  const targets = new Set<string>();
  for (const c of corrections) {
    const targetId = c.replacesEventId ?? c.voidsEventId;
    if (!targetId) throw new EngineError("Each change must name the event it corrects");
    if (!c.reason || !c.reason.trim()) throw new EngineError("A correction needs a reason");
    const target = events.find((e) => e.id === targetId);
    if (!target) throw new EngineError("The event being corrected is not in this match");
    if (superseded.includes(target.id) || targets.has(target.id)) throw new EngineError("That event has already been corrected");
    targets.add(target.id);
  }
  const before = new Set(reconstruct(engine, ctx, rules, events).issues.filter((i) => i.severity === "error").map(errorKey));
  const after = reconstruct(engine, ctx, rules, [...events, ...corrections]);
  const introduced = after.issues.find((i) => i.severity === "error" && !before.has(errorKey(i)));
  if (introduced) throw new EngineError(`This change is not possible: ${introduced.message}`);
  return after;
}
