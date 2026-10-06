// The scorer's running clocks. The game clock and the shot clock run on
// the scorer's device; every event carries their readings. Two rules
// keep a running clock from ever costing the scorer a tap:
//  - the shot clock resets the way the rulebook says after each event
//    (a new possession starts it in full, an offensive rebound or a
//    defensive foul tops it up to the reset value), and
//  - a reading is only attached when the engine will accept it. A
//    refused event would drop every tap queued behind it, so a reading
//    the engine would refuse (the clock set back by hand, the shot clock
//    switched off late in a period) is left off instead.

import { shotClockCapFor, type BasketballState } from "../basketball";
import { periodSeconds, type BasketballRules } from "./rules";

type Payload = Record<string, unknown>;

/**
 * The shot clock, in seconds, after an event of this type. Returns
 * `current` when the event leaves it running. Only meaningful when the
 * competition plays with a shot clock.
 */
export function shotClockAfter(type: string, payload: Payload, current: number, rules: BasketballRules): number {
  const full = rules.shotClockSeconds;
  if (full === null) return current;
  const reset = rules.shotClockReset ?? full;
  const topUp = Math.max(current, reset);
  switch (type) {
    // the other team, or a fresh possession, has the ball
    case "PERIOD_START": case "JUMP_BALL": case "HELD_BALL": case "STEAL": case "TURNOVER": case "OUT_OF_BOUNDS":
    case "SHOT_MADE": case "FREE_THROW_MADE": case "GOALTENDING":
      return full;
    case "REBOUND":
      return payload.offensive === true ? reset : full;
    case "VIOLATION":
      if (payload.kind === "kicked_ball") return topUp;
      // defensive three seconds: the offence keeps the ball and the clock
      return payload.kind === "defensive_three_seconds" ? current : full;
    case "FOUL":
      if (payload.kind === "technical") return current;
      // an offensive foul is a turnover
      return payload.kind === "offensive" ? full : topUp;
    default:
      return current;
  }
}

/**
 * The clock readings to attach to an event: whole seconds, rounded up the
 * way a scoreboard shows them, and only those the engine will accept.
 */
export function clockReadings(
  s: BasketballState, rules: BasketballRules, type: string, payload: Payload,
  game: number | null, shot: number | null,
): { clock?: number; shotClock?: number } {
  // a period starts at its full length; the engine sets that itself
  if (type === "PERIOD_START" || !s.periodOpen || game === null) return {};
  const clock = Math.max(0, Math.ceil(game));
  if (clock > periodSeconds(s.period, rules)) return {};
  // the clock was set back by hand past what was already recorded
  if (s.clock !== null && clock > s.clock) return {};
  const out: { clock?: number; shotClock?: number } = { clock };

  if (shot === null || rules.shotClockSeconds === null) return out;
  const shotClock = Math.max(0, Math.ceil(shot));
  // with less game time left than shot clock, the shot clock is switched off
  if (shotClock > rules.shotClockSeconds || shotClock > clock) return out;
  const cap = shotClockCapFor(s, { id: "", seq: s.lastSeq + 1, type, payload, occurredAt: "" }, rules);
  if (cap !== null && shotClock > cap) return out;
  return { ...out, shotClock };
}

/** "6:42", or "8.4" in the last minute, as a game clock shows it. */
export function clockText(seconds: number): string {
  if (seconds < 60) return seconds <= 0 ? "0.0" : (Math.floor(seconds * 10) / 10).toFixed(1);
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "6:42" or "42" -> seconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d))?\s*$/.exec(text);
  if (!m) return null;
  const min = m[1] ? Number(m[1]) : 0;
  const sec = Number(m[2]);
  if (m[1] && sec > 59) return null;
  return min * 60 + sec + (m[3] ? Number(m[3]) / 10 : 0);
}
