// Shared by the rally sports (badminton, pickleball, volleyball, tennis):
// why a rally did or did not change the score, and the figures they all
// record. Each sport supplies its own words for how a rally ended.

import type { MatchContext, Side } from "../core/types";
import type { Explanation, StatTerm } from "../core/ask";
import { sideName } from "../core/util";
import type { Rally } from "../sports/rally";

const label = (k: string) => k.replace(/_/g, " ");

export function rallyExplanations(
  rallies: Rally[], ctx: MatchContext,
  opts: { unit: (g: number) => string; how?: Record<string, string>; sideOut?: (r: Rally) => string },
): Explanation[] {
  return rallies.slice(-12).map((r) => {
    const winner = sideName(ctx, r.w);
    const how = r.how && r.how !== "other" ? ` (${opts.how?.[r.how] ?? label(r.how)})` : "";
    if (r.pt) {
      const scorer: Side = r.pt;
      return { kind: "score", text: `${sideName(ctx, scorer)} scored because ${winner} won the rally${how}. It is ${r.a}-${r.b} in ${opts.unit(r.g)}.` };
    }
    return { kind: "no_score", text: `${winner} won the rally${how} but did not score: only the serving side scores. ${opts.sideOut?.(r) ?? `Side out: ${winner} serve next.`} Still ${r.a}-${r.b} in ${opts.unit(r.g)}.` };
  });
}

export const RALLY_STATS: StatTerm[] = [
  { re: /won on serve|serve (points|rallies) won|service points won|serving %/, key: "servePointPct", label: "of points won on serve", format: "pct" },
  { re: /won on return|return points|receiving %/, key: "returnPointPct", label: "of points won on return", format: "pct" },
  { re: /points? won %|share of points|win(ning)? percentage of points/, key: "pointWinPct", label: "of points won", format: "pct" },
  { re: /longest rally/, key: "longestRally", label: "shots in the longest rally" },
  { re: /average rally|avg rally|rally length/, key: "avgRally", label: "shots per rally on average", format: "dec1" },
  { re: /streak|in a row|longest run/, key: "longestStreak", label: "points in a row (longest)" },
  { re: /\baces?\b/, key: "aces", label: "aces" },
  { re: /unforced errors?/, key: "unforcedErrors", label: "unforced errors" },
  { re: /\bwinners\b/, key: "winners", label: "winners" },
  { re: /points (lost|against)|conceded/, key: "pointsAgainst", label: "points lost" },
  { re: /\bpoints?\b/, key: "points", label: "points" },
];

/**
 * "What the data says" for a rally sport, each line from recorded rallies:
 * the current or final state, runs of points, comebacks within a game,
 * serve and return, recent momentum, and how points were won and lost.
 */
export function rallyInsights(
  rallies: Rally[], ctx: MatchContext,
  opts: {
    unit: string;                         // "game", "set"
    games: { a: number; b: number; winner: Side | null }[];
    won: Record<Side, number>;            // games or sets won
    decided: Side | null;
    team: Record<Side, Record<string, number>>;
    counts: [string, string][];           // team counter key, words
  },
): string[] {
  const out: string[] = [];
  if (!rallies.length) return out;
  const name = (s: Side) => sideName(ctx, s);
  const other = (s: Side): Side => (s === "a" ? "b" : "a");
  const { unit, games } = opts;

  // where the match stands
  if (opts.decided) {
    const w = opts.decided;
    // each game read from the winner's side: "25-10", not "10-25"
    out.push(`${name(w)} won ${opts.won[w]}-${opts.won[other(w)]} in ${unit}s (${games.filter((g) => g.winner).map((g) => `${g[w]}-${g[other(w)]}`).join(", ")}).`);
  } else {
    const cur = games[games.length - 1];
    const lead: Side | null = opts.won.a === opts.won.b ? null : opts.won.a > opts.won.b ? "a" : "b";
    out.push(`${lead ? `${name(lead)} lead ${opts.won[lead]}-${opts.won[other(lead)]} in ${unit}s` : `Level at ${opts.won.a}-${opts.won.b} in ${unit}s`}; ${cur ? `${cur.a}-${cur.b} in ${unit} ${games.length}` : ""}.`);
  }

  // the longest run of points, and where it happened
  let best: { side: Side; len: number; g: number } | null = null;
  let run: { side: Side | null; len: number; g: number } = { side: null, len: 0, g: -1 };
  for (const r of rallies) {
    run = r.w === run.side && r.g === run.g ? { ...run, len: run.len + 1 } : { side: r.w, len: 1, g: r.g };
    if (run.side && (!best || run.len > best.len)) best = { side: run.side, len: run.len, g: run.g };
  }
  if (best && best.len >= 5) out.push(`${name(best.side)} won ${best.len} rallies in a row in ${unit} ${best.g + 1}.`);

  // a comeback inside a finished game: the winner was 4 or more points down
  games.forEach((g, i) => {
    if (!g.winner) return;
    const w = g.winner;
    let worst = 0;
    for (const r of rallies.filter((x) => x.g === i)) worst = Math.max(worst, r[other(w)] - r[w]);
    if (worst >= 4) out.push(`${name(w)} came back from ${worst} points down to win ${unit} ${i + 1}.`);
  });

  // serve and return
  for (const side of ["a", "b"] as Side[]) {
    const served = rallies.filter((r) => r.srv === side), won = served.filter((r) => r.w === side).length;
    if (served.length >= 10) {
      const pctServe = Math.round((100 * won) / served.length);
      if (pctServe >= 65 || pctServe <= 40) out.push(`${name(side)} won ${pctServe}% of rallies on their own serve (${won} of ${served.length}).`);
    }
  }

  // momentum: the last ten rallies
  if (!opts.decided && rallies.length >= 10) {
    const last = rallies.slice(-10), a = last.filter((r) => r.w === "a").length;
    if (a >= 8 || a <= 2) out.push(`${name(a >= 8 ? "a" : "b")} have won ${Math.max(a, 10 - a)} of the last 10 rallies.`);
  }

  // how points were won and lost
  for (const [key, words] of opts.counts) {
    const a = opts.team.a[key] ?? 0, b = opts.team.b[key] ?? 0;
    if (a + b >= 3 && Math.abs(a - b) >= 3) { const more: Side = a > b ? "a" : "b"; out.push(`${name(more)} ${words}: ${Math.max(a, b)} to ${Math.min(a, b)}.`); }
  }
  return out;
}
