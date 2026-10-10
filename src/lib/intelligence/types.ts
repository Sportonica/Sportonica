// Shapes shared by the Sports Intelligence actions and UI. The engine
// contracts themselves are in ./core/types.

import type { ContestSummary } from "./core/engine";
import type { Analytics, ContestStatus, GuideSection, Issue, MatchContext, SportKey, StatColumn, StatTable, StatValue } from "./core/types";

export interface ContestView {
  id: string;
  tournamentId: string;
  matchId: string | null;
  sport: SportKey;
  label: string | null;
  status: ContestStatus;
  lastSeq: number;
  summary: ContestSummary;
  context: MatchContext;
  rules: Record<string, unknown>;
  // the engine state, for scorer pads that need more than the score card
  // (who is at the crease, who is on court)
  state: unknown;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface TimelineEntry {
  id: string;
  seq: number;
  type: string;
  text: string;
  // where the event fell in the match ("1st innings 17.4"), when the sport numbers its events
  label: string | null;
  occurredAt: string;
  recordedBy: string | null;
  // cancelled by a reversal, or replaced by a later event
  superseded: boolean;
  correction: { kind: "void" | "replace"; targetSeq: number | null; reason: string; scoreBefore?: string; scoreAfter?: string } | null;
  // what the rules worked out from this event (game won, side out ...)
  derived: string[];
  payload: Record<string, unknown>;
  // where it sits in the match (an edit where the ball it replaced was, a missed ball just before the ball it was recorded ahead of); sports that number their events only
  position?: number;
}

export interface ContestIntelligence {
  players: StatTable[];
  teams: StatTable[];
  analytics: Analytics;
  // "How scoring works", from the rules this match is played under
  guide?: GuideSection[];
}

export interface RecalculationReport {
  contest: ContestView;
  issues: Issue[];
  // true when the stored snapshot did not match what the events rebuild
  drift: boolean;
  events: number;
}

export interface HistoryRow {
  contestId: string;
  tournamentId: string;
  playedAt: string;
  eventKey: string | null;
  raw: Record<string, number>;
}

export interface HistoryReport {
  sport: SportKey;
  contests: number;
  columns: StatColumn[];
  values: Record<string, StatValue>;
  rows: HistoryRow[];
}

export interface SwimEventPerformance {
  eventKey: string;
  eventName: string;
  swims: number;
  personalBestMs: number | null;
  seasonBestMs: number | null;
  averageMs: number | null;
  latestMs: number | null;
  latestImprovementMs: number | null;
  latestImprovementPct: number | null;
  latestIsPersonalBest: boolean;
  progression: { date: string; timeMs: number }[];
}

export interface LeaderRow {
  subjectKey: string;
  name: string;
  teamName: string;
  contests: number;
  values: Record<string, StatValue>;
}

export interface TournamentLeaders {
  sport: SportKey;
  columns: StatColumn[];
  rows: LeaderRow[];
}

export interface RecordEventInput {
  type: string;
  payload?: Record<string, unknown>;
  // generated on the scorer's device: a retried or double-tapped event is stored once
  clientId: string;
  occurredAt?: string;
}

export interface RecordEventResult {
  contest: ContestView;
  duplicate: boolean;
  warning: string | null;
}

export interface HistoryFilter {
  tournamentId?: string;
  from?: string;
  to?: string;
  eventKey?: string;
  limit?: number;
}

export const SI_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "You don't have permission to score this tournament.",
  CONTEST_NOT_FOUND: "That match isn't set up for live scoring.",
  MATCH_NOT_FOUND: "Match not found.",
  TEAMS_NOT_SET: "Both teams for this match aren't set yet.",
  MATCH_ALREADY_DONE: "This match already has a final result.",
  SEQ_CONFLICT: "Another scorer recorded an event at the same moment. The score has been refreshed. Check it and try again.",
  REASON_REQUIRED: "Give a reason for the correction.",
  EVENT_NOT_FOUND: "That event isn't part of this match.",
  SI_EVENTS_IMMUTABLE: "Recorded events can't be edited or deleted. Record a correction instead.",
  NOT_SET_UP: "Live scoring isn't set up on this database yet. Apply db/sports_intelligence.sql in Supabase.",
  SPORT_NOT_ENABLED: "This sport isn't enabled for live scoring on this database yet. Apply db/sports_intelligence_tennis.sql in Supabase.",
  MATCH_RULES_NOT_SET_UP: "Changing a match's rules isn't set up on this database yet. Apply db/si_contest_rules.sql in Supabase.",
  INVALID_RULES: "Those rules are not valid.",
};

export function friendlyIntelligenceError(message: string): string {
  // PostgREST / Postgres "relation or function does not exist"
  if (/si_set_contest_rules/.test(message) && /(does not exist|Could not find|schema cache)/i.test(message)) return SI_ERROR_MESSAGES.MATCH_RULES_NOT_SET_UP;
  if (/si_(contests|events|stat_lines|append_event|open_contest|save_snapshot|set_scoring_rules|can_score)/.test(message) && /(does not exist|Could not find|schema cache)/i.test(message)) {
    return SI_ERROR_MESSAGES.NOT_SET_UP;
  }
  // a sport the database's list does not have yet (tennis before its script is applied)
  if (/si_contests_sport_check/.test(message)) return SI_ERROR_MESSAGES.SPORT_NOT_ENABLED;
  for (const code in SI_ERROR_MESSAGES) if (message.includes(code)) return SI_ERROR_MESSAGES[code];
  return message;
}
