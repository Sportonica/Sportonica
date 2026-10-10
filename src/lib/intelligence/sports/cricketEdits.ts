// Fixes that touch many balls at once, worked out from the event log:
// the wrong player picked (their batting, bowling or fielding moves to the
// right one; if both played in that role they swap) and the wrong bowler
// for an over. Each becomes a
// set of replacement events (core/engine applyCorrections), so the original
// balls stay in the record and the match is replayed from the log.

import { effectiveEvents, reconstruct } from "../core/engine";
import type { MatchContext, SportIntelligenceEngine, StoredEvent } from "../core/types";
import { sideOfPlayer } from "../core/util";
import { parseBallLabel } from "./cricketView";

/** Which of a player's records move: their batting, their bowling, their catches and run outs, or all. */
export type PlayerRole = "batting" | "bowling" | "fielding" | "all";

export type CricketBulkEdit =
  | { kind: "player"; from: string; to: string; role: PlayerRole }
  | { kind: "overBowler"; over: string; bowler: string };

/** One over of the match, for picking which over's bowler to change. */
export interface OverRef { key: string; label: string; bowler: string; balls: number }

// which payload keys hold a player in each role (DELIVERY, NEW_BATTER, RETIRE, INNINGS_START, SUPER_OVER_START)
const ROLE_KEYS: Record<Exclude<PlayerRole, "all">, string[]> = {
  batting: ["striker", "nonStriker", "player"],
  bowling: ["bowler"],
  fielding: ["fielder"],
};
const keysFor = (role: PlayerRole): Set<string> =>
  new Set(role === "all" ? Object.values(ROLE_KEYS).flat() : ROLE_KEYS[role]);

/** The ids under those keys swapped, a for b and b for a (a player who never appeared there is simply replaced). */
function swapIds(value: unknown, a: string, b: string, keys: Set<string>, key = ""): unknown {
  if (typeof value === "string") return keys.has(key) ? (value === a ? b : value === b ? a : value) : value;
  if (Array.isArray(value)) return value.map((v) => swapIds(v, a, b, keys, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => k !== "audit").map(([k, v]) => [k, swapIds(v, a, b, keys, k)]));
  }
  return value;
}

const mentions = (value: unknown, ids: string[], keys: Set<string>, key = ""): boolean =>
  typeof value === "string" ? keys.has(key) && ids.includes(value)
    : Array.isArray(value) ? value.some((v) => mentions(v, ids, keys, key))
    : !!value && typeof value === "object" && Object.entries(value).some(([k, v]) => k !== "audit" && mentions(v, ids, keys, k));

/** The over a ball belongs to, from the label the engine gives it ("2nd innings 3.4" -> over 4 of the 2nd innings). */
function overKey(label: string | null): { key: string; label: string } | null {
  const b = parseBallLabel(label);
  if (!b) return null;
  const over = Number(b.ball.split(".")[0]) + 1;
  const inn = b.superOver ? `Super over ${b.innings}` : `${b.innings}${["th", "st", "nd", "rd"][(b.innings % 100 > 10 && b.innings % 100 < 14) || b.innings % 10 > 3 ? 0 : b.innings % 10]} innings`;
  return { key: `${b.superOver ? "S" : "I"}${b.innings}:${over}`, label: `${inn}, over ${over}` };
}

/** Overs bowled so far, in order, with the bowler of each. */
export function oversOf<R, S>(engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[]): OverRef[] {
  const { list } = effectiveEvents(events);
  const labels = reconstruct(engine, ctx, rules, events).labels;
  const out = new Map<string, OverRef>();
  for (const ev of list) {
    if (ev.type !== "DELIVERY") continue;
    const o = overKey(labels[ev.seq] ?? null);
    if (!o) continue;
    const cur = out.get(o.key);
    if (cur) cur.balls += 1;
    else out.set(o.key, { key: o.key, label: o.label, bowler: String((ev.payload as { bowler?: unknown }).bowler ?? ""), balls: 1 });
  }
  return [...out.values()];
}

/**
 * The events to replace and what they become. Throws a plain sentence when
 * the fix makes no sense (players on different teams, nothing to change).
 */
export function planBulkEdit<R, S>(
  engine: SportIntelligenceEngine<R, S>, ctx: MatchContext, rules: R, events: StoredEvent[], edit: CricketBulkEdit,
): { target: StoredEvent; payload: Record<string, unknown> }[] {
  const { list } = effectiveEvents(events);
  if (edit.kind === "player") {
    if (!edit.from || !edit.to || edit.from === edit.to) throw new Error("Pick two different players");
    const sf = sideOfPlayer(ctx, edit.from), st = sideOfPlayer(ctx, edit.to);
    if (!sf || !st) throw new Error("Both players must be in this match's squads");
    if (sf !== st) throw new Error("Both players must be on the same team");
    const keys = keysFor(edit.role);
    const plan = list.filter((ev) => mentions(ev.payload, [edit.from, edit.to], keys))
      .map((ev) => ({ target: ev, payload: swapIds(ev.payload ?? {}, edit.from, edit.to, keys) as Record<string, unknown> }));
    if (!plan.length) throw new Error(`That player has no ${edit.role === "all" ? "balls" : edit.role} in this match`);
    return plan;
  }
  const labels = reconstruct(engine, ctx, rules, events).labels;
  const balls = list.filter((ev) => ev.type === "DELIVERY" && overKey(labels[ev.seq] ?? null)?.key === edit.over);
  if (!balls.length) throw new Error("That over has no balls");
  const fielding = sideOfPlayer(ctx, String((balls[0].payload as { bowler?: unknown }).bowler ?? ""));
  if (!edit.bowler || sideOfPlayer(ctx, edit.bowler) !== fielding) throw new Error("The bowler must be on the fielding team");
  const plan = balls.filter((ev) => (ev.payload as { bowler?: unknown }).bowler !== edit.bowler)
    .map((ev) => ({ target: ev, payload: { ...withoutAudit(ev.payload), bowler: edit.bowler } }));
  if (!plan.length) throw new Error("That over is already down to that bowler");
  return plan;
}

// the score-before/after note belongs to the correction that wrote it, not to the ball
function withoutAudit(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload ?? {}).filter(([k]) => k !== "audit"));
}

/** A knock-on change from editing one ball: replace a later event, or take it out. */
export type FollowOn = { target: StoredEvent; payload: Record<string, unknown> } | { target: StoredEvent; remove: true };

const outOf = (p: Record<string, unknown> | undefined): string | null => {
  const w = p?.wicket as { player?: unknown } | null | undefined;
  if (!w) return null;
  return typeof w.player === "string" ? w.player : typeof p?.striker === "string" ? p.striker : null;
};

/**
 * Editing a ball's wicket changes who bats after it. A wicket taken away:
 * the batter who came in for it never did, and the reinstated batter faced
 * their balls. The wrong batter out: the two swap from that ball on. Only
 * the rest of that innings is touched. Adding a wicket is left to the
 * scorer (who came in is not known).
 */
export function planWicketFollowOn(events: StoredEvent[], targetId: string, payload: Record<string, unknown>): FollowOn[] {
  const { list } = effectiveEvents(events);
  const at = list.findIndex((e) => e.id === targetId);
  if (at < 0 || list[at].type !== "DELIVERY") return [];
  const before = outOf(list[at].payload), after = outOf(payload);
  if (!before || before === after) return [];
  const rest: StoredEvent[] = [];
  for (const ev of list.slice(at + 1)) {
    if (ev.type === "INNINGS_START" || ev.type === "SUPER_OVER_START") break;
    rest.push(ev);
  }
  const batting = keysFor("batting");
  const swap = (from: StoredEvent[], a: string, b: string): FollowOn[] => from
    .filter((ev) => mentions(ev.payload, [a, b], batting))
    .map((ev) => ({ target: ev, payload: swapIds(ev.payload ?? {}, a, b, batting) as Record<string, unknown> }));

  if (after) return swap(rest, before, after);
  const came = rest.findIndex((ev) => ev.type === "NEW_BATTER");
  if (came < 0) return [];
  const incoming = String((rest[came].payload as { player?: unknown }).player ?? "");
  if (!incoming) return [];
  return [{ target: rest[came], remove: true }, ...swap(rest.slice(came + 1), incoming, before)];
}
