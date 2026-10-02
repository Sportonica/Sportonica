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
