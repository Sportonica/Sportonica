// Historical statistics: sum the raw counters stored per contest, then
// let the sport's engine derive percentages and averages from the sums.
// A derived figure is never averaged across matches (the average of two
// shooting percentages is not the shooting percentage).

import type { SportIntelligenceEngine, StatColumn, StatValue } from "./core/types";

// How a raw counter combines across contests. Everything is summed
// except keys that name an extreme.
const MAX_PREFIXES = ["longest", "max", "best"];
const MIN_PREFIXES = ["fastest", "min"];
// per-contest facts that mean nothing once summed
const DROP = new Set(["lane", "place"]);

const startsWithAny = (key: string, prefixes: string[]): boolean => prefixes.some((p) => key.startsWith(p));

export function sumRaw(lines: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of lines) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== "number" || !Number.isFinite(v) || DROP.has(k)) continue;
      if (startsWithAny(k, MAX_PREFIXES)) out[k] = k in out ? Math.max(out[k], v) : v;
      else if (startsWithAny(k, MIN_PREFIXES)) out[k] = k in out ? Math.min(out[k], v) : v;
      else out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

export interface Aggregate {
  contests: number;
  raw: Record<string, number>;
  columns: StatColumn[];
  values: Record<string, StatValue>;
}

export function aggregate(engine: SportIntelligenceEngine, subject: "player" | "team", lines: Record<string, number>[]): Aggregate {
  const raw = sumRaw(lines);
  const { columns, values } = engine.deriveStats(subject, raw);
  return { contests: lines.length, raw, columns, values };
}
