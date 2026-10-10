// si_contests row -> what the UI works with. Shared by the server
// actions and the Realtime subscription, which receives the raw row.

import type { MatchEnvelope } from "./core/engine";
import type { MatchContext, SportKey } from "./core/types";
import type { ContestView } from "./types";

export interface ContestRow {
  id: string;
  tournament_id: string;
  match_id: string | null;
  sport: string;
  label: string | null;
  rules: Record<string, unknown>;
  context: MatchContext;
  status: ContestView["status"];
  state: MatchEnvelope;
  summary: ContestView["summary"];
  last_seq: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function toView(row: ContestRow): ContestView {
  return {
    id: row.id, tournamentId: row.tournament_id, matchId: row.match_id, sport: row.sport as SportKey, label: row.label,
    status: row.status, lastSeq: row.last_seq, summary: row.summary, context: row.context, rules: row.rules,
    state: row.state?.sport ?? null,
    startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at,
  };
}

// Postgres leaves a large (TOASTed) column out of a change record when the
// update did not touch it, so a Realtime push can arrive without the rosters
// (context), or without the state after a roster edit. Keep what the viewer has.
export function fromPush(row: Partial<ContestRow>, cur: ContestView): ContestView {
  const view = toView(row as ContestRow);
  return {
    ...view,
    context: row.context ?? cur.context, rules: row.rules ?? cur.rules, summary: row.summary ?? cur.summary,
    state: row.state === undefined ? cur.state : view.state,
  };
}
