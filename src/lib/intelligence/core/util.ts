// Small shared helpers for the engines. Nothing sport-specific.

import type { MatchContext, Participant, Payload, Side, StatValue } from "./types";

/** a / b, or null when the denominator is missing or zero. Never 0-for-unknown. */
export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function pct(a: number | null | undefined, b: number | null | undefined): number | null {
  const r = ratio(a, b);
  return r === null ? null : r * 100;
}

export function round(n: number | null, places = 2): number | null {
  if (n === null) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
export const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;
export const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
export const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function playersOf(ctx: MatchContext, side: Side): Participant[] {
  return ctx.sides ? ctx.sides[side].players : [];
}

export function sideOfPlayer(ctx: MatchContext, playerId: string): Side | null {
  if (!ctx.sides) return null;
  if (ctx.sides.a.players.some((p) => p.id === playerId)) return "a";
  if (ctx.sides.b.players.some((p) => p.id === playerId)) return "b";
  return null;
}

export function playerName(ctx: MatchContext, playerId: string | null | undefined): string {
  if (!playerId || !ctx.sides) return "";
  const p = [...ctx.sides.a.players, ...ctx.sides.b.players].find((x) => x.id === playerId);
  return p?.name ?? "Unknown player";
}

export function sideName(ctx: MatchContext, side: Side): string {
  return ctx.sides?.[side].name ?? (side === "a" ? "Side A" : "Side B");
}

/** Optional player field: null if absent, error text if present but not on `side`. */
export function checkPlayer(ctx: MatchContext, payload: Payload, key: string, side: Side): string | null {
  const id = payload[key];
  if (id === undefined || id === null) return null;
  if (typeof id !== "string") return `${key} must be a player id`;
  if (sideOfPlayer(ctx, id) !== side) return `That player is not in ${sideName(ctx, side)}`;
  return null;
}

// ── durations (swimming, clocks) ────────────────────────────────────
// A time is always an integer number of milliseconds. "01:02.45" is
// 62 450 ms; it is never the decimal number 1.0245.

/** "52.34" | "1:02.45" | "01:02.450" | "1:01:02.45" -> ms, or null if not a time. */
export function parseDuration(text: string): number | null {
  const m = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const [, first, second, secs, frac] = m;
  let h = 0, min = 0;
  if (first !== undefined && second !== undefined) { h = Number(first); min = Number(second); }
  else if (first !== undefined) { min = Number(first); }
  const s = Number(secs);
  if (s >= 60 || (h > 0 && min >= 60)) return null;
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

/** ms -> "52.34" | "1:02.45" | "1:01:02.45" (hundredths, truncated as timing systems do). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(ms));
  const hundredths = Math.floor(abs / 10);
  const hh = hundredths % 100;
  const totalSec = Math.floor(hundredths / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${sign}${h}:${p2(m)}:${p2(s)}.${p2(hh)}`;
  if (m > 0) return `${sign}${m}:${p2(s)}.${p2(hh)}`;
  return `${sign}${s}.${p2(hh)}`;
}

/** Seconds left on a game clock -> "02:31". */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatStat(v: StatValue, format?: string): string {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "string") return v;
  switch (format) {
    case "pct": return `${v.toFixed(1)}%`;
    case "dec1": return v.toFixed(1);
    case "dec2": return v.toFixed(2);
    case "time": return formatDuration(v);
    default: return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
}

/** Merge a rules object over defaults, ignoring keys the sport does not define. */
export function mergeRules<R extends object>(defaults: R, input: unknown): R {
  const out = { ...defaults } as Record<string, unknown>;
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k in out && v !== undefined) out[k] = v;
    }
  }
  return out as R;
}

export function add(rec: Record<string, number>, key: string, n = 1): void {
  rec[key] = (rec[key] ?? 0) + n;
}
