// Basketball: the wrong player picked, fixed across the whole game. Every
// event that names them (shots, assists, rebounds, fouls, substitutions,
// lineups) moves to the right player, or the two swap if both played.

import { effectiveEvents } from "../core/engine";
import { mentions, swapIds } from "../core/edits";
import type { MatchContext, StoredEvent } from "../core/types";
import { sideOfPlayer } from "../core/util";

// payload keys that hold a player in basketball events
const PLAYER_KEYS = new Set(["player", "assist", "shooter", "in", "out", "players", "on"]);

export function planBasketballPlayerSwap(events: StoredEvent[], ctx: MatchContext, from: string, to: string): { target: StoredEvent; payload: Record<string, unknown> }[] {
  if (!from || !to || from === to) throw new Error("Pick two different players");
  const sf = sideOfPlayer(ctx, from), st = sideOfPlayer(ctx, to);
  if (!sf || !st) throw new Error("Both players must be in this game's squads");
  if (sf !== st) throw new Error("Both players must be on the same team");
  const plan = effectiveEvents(events).list
    .filter((ev) => mentions(ev.payload, [from, to], PLAYER_KEYS))
    .map((ev) => ({ target: ev, payload: swapIds(ev.payload ?? {}, from, to, PLAYER_KEYS) as Record<string, unknown> }));
  if (!plan.length) throw new Error("That player has nothing recorded in this game");
  return plan;
}

/** Players who appear in the game's events, for "recorded as". */
export function playersInEvents(events: { payload: Record<string, unknown> }[], ids: string[]): Set<string> {
  return new Set(ids.filter((id) => events.some((e) => mentions(e.payload, [id], PLAYER_KEYS))));
}
