// A match's score in its own sport's terms, small enough to put on a
// fixture row or a home-page card. Football scores are two numbers;
// a cricket score is "164/6" with overs, a badminton score is games
// with the current game's points. This carries whichever applies, so
// the cards that show it never need to know the sport.

import type { ContestSummary } from "./core/engine";
import type { ContestStatus } from "./core/types";

export interface MatchIntel {
  contestId: string;
  status: ContestStatus;
  a: string;
  b: string;
  // under the score: "18 : 16", "21-18, 19-21, 21-15", "17.3 ov · need 21 runs from 15 balls"
  brief: string;
  // "Q4, 02:31 remaining", "Set 4", "1st innings"
  period: string;
  result: string | null;
}

export function toMatchIntel(row: { id: string; status: ContestStatus; summary: ContestSummary | null }): MatchIntel | null {
  const v = row.summary?.view;
  if (!v || v.kind !== "versus" || !v.score) return null;
  return {
    contestId: row.id, status: row.status, a: v.score.a, b: v.score.b,
    brief: v.brief ?? "", period: v.periodLabel, result: row.summary?.resultText ?? null,
  };
}

/** What the status pill on a card should say. */
export function intelPill(i: MatchIntel): { label: string; live: boolean } {
  switch (i.status) {
    case "live": return { label: "Live", live: true };
    case "paused": return { label: "Paused", live: false };
    case "completed": return { label: "Final", live: false };
    case "abandoned": return { label: "Abandoned", live: false };
    case "postponed": return { label: "Postponed", live: false };
    case "cancelled": return { label: "Cancelled", live: false };
    default: return { label: "Upcoming", live: false };
  }
}
