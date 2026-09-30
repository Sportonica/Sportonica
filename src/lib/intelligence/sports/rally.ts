// Shared arithmetic for the rally sports (badminton, pickleball,
// volleyball). Only the counting lives here: who serves next, when a
// game ends and what a rally is worth are each sport's own rules.

import { SIDES, otherSide, type Chart, type Side, type StatColumn, type StatValue } from "../core/types";
import { pct, ratio, round } from "../core/util";

export interface Rally {
  seq: number;
  /** rally winner */
  w: Side;
  /** who served it */
  srv: Side;
  /** who scored from it; null when a side-out rally gave no point */
  pt: Side | null;
  /** game (or set) index, 0-based across the match */
  g: number;
  /** score in that game after the rally */
  a: number;
  b: number;
  shots?: number;
  how?: string;
}

export interface GameScore { a: number; b: number; winner: Side | null }

/** Has `side` won a game at this score? */
export function gameWonBy(g: GameScore, target: number, winBy: number, cap: number | null): Side | null {
  for (const s of SIDES) {
    const mine = g[s], theirs = g[otherSide(s)];
    if (cap !== null && mine >= cap && mine > theirs) return s;
    if (mine >= target && mine - theirs >= winBy) return s;
  }
  return null;
}

/** Longest and current unbroken run of rallies won. */
export function streaks(rallies: Rally[]): { longest: Record<Side, number>; current: { side: Side | null; length: number } } {
  const longest: Record<Side, number> = { a: 0, b: 0 };
  let side: Side | null = null, length = 0;
  for (const r of rallies) {
    if (r.w === side) length += 1; else { side = r.w; length = 1; }
    if (length > longest[side]) longest[side] = length;
  }
  return { longest, current: { side, length } };
}

/** Share of the last `window` rallies won by each side, 0..100. */
export function momentum(rallies: Rally[], window = 10): Record<Side, number> | null {
  const last = rallies.slice(-window);
  if (!last.length) return null;
  const a = last.filter((r) => r.w === "a").length;
  return { a: round((a / last.length) * 100, 1)!, b: round(((last.length - a) / last.length) * 100, 1)! };
}

/** Raw rally counters for one side. */
export function rallyRaw(rallies: Rally[], side: Side): Record<string, number> {
  const raw: Record<string, number> = {
    ralliesWon: 0, ralliesLost: 0, points: 0, pointsAgainst: 0,
    served: 0, serveWon: 0, received: 0, returnWon: 0,
    shotsTotal: 0, ralliesWithLength: 0, longestRally: 0,
    longestStreak: streaks(rallies).longest[side],
  };
  for (const r of rallies) {
    if (r.w === side) raw.ralliesWon += 1; else raw.ralliesLost += 1;
    if (r.pt === side) raw.points += 1; else if (r.pt) raw.pointsAgainst += 1;
    if (r.srv === side) { raw.served += 1; if (r.w === side) raw.serveWon += 1; }
    else { raw.received += 1; if (r.w === side) raw.returnWon += 1; }
    if (r.shots !== undefined) {
      raw.shotsTotal += r.shots; raw.ralliesWithLength += 1;
      if (r.shots > raw.longestRally) raw.longestRally = r.shots;
    }
  }
  return raw;
}

export const RALLY_DERIVED_COLUMNS: StatColumn[] = [
  { key: "pointWinPct", label: "Points won %", kind: "derived", format: "pct" },
  { key: "servePointPct", label: "Won on serve %", kind: "derived", format: "pct" },
  { key: "returnPointPct", label: "Won on return %", kind: "derived", format: "pct" },
  { key: "avgRally", label: "Avg rally", kind: "derived", format: "dec1" },
];

/** Percentages from summed raw counters. Works for one match or a career. */
export function rallyDerived(raw: Record<string, number>): Record<string, StatValue> {
  const played = (raw.ralliesWon ?? 0) + (raw.ralliesLost ?? 0);
  return {
    pointWinPct: round(pct(raw.ralliesWon, played), 1),
    servePointPct: round(pct(raw.serveWon, raw.served), 1),
    returnPointPct: round(pct(raw.returnWon, raw.received), 1),
    // only over rallies whose length was actually recorded
    avgRally: round(ratio(raw.shotsTotal, raw.ralliesWithLength), 1),
  };
}

/** One line chart per game: both sides' score after every rally. */
export function progressionCharts(rallies: Rally[], names: Record<Side, string>, unitLabel: string): Chart[] {
  const games = [...new Set(rallies.map((r) => r.g))].sort((x, y) => x - y);
  return games.map((g) => {
    const rs = rallies.filter((r) => r.g === g);
    return {
      key: `progression-${g}`,
      title: `${unitLabel} ${g + 1}: score progression`,
      type: "line" as const,
      labels: ["0", ...rs.map((_, i) => String(i + 1))],
      series: SIDES.map((s) => ({ name: names[s], side: s, values: [0, ...rs.map((r) => r[s])] })),
      format: "int" as const,
    };
  });
}

/** Runs of at least `min` unanswered rallies, newest last. */
export function scoringRuns(rallies: Rally[], min: number): { side: Side; length: number; g: number }[] {
  const out: { side: Side; length: number; g: number }[] = [];
  let side: Side | null = null, length = 0, g = -1;
  const flush = () => { if (side && length >= min) out.push({ side, length, g }); };
  for (const r of rallies) {
    if (r.w === side && r.g === g) length += 1;
    else { flush(); side = r.w; length = 1; g = r.g; }
  }
  flush();
  return out;
}
