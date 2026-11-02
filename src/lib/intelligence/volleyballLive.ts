// A volleyball match in progress keeps no stat lines (those are written when
// it finishes, and career figures wait for that). Tournament leaderboards and
// player cards still follow the match, so its lines are worked out here from
// the contest's state, by the same engine.

import type { MatchContext } from "./core/types";
import { volleyballEngine } from "./sports/volleyball";

export const LIVE_CONTEST_COLUMNS = "id, tournament_id, match_id, context, rules, state";
export const IN_PLAY = ["live", "paused"];

export interface LiveContestRow { id: string; tournament_id: string; match_id: string | null; context: MatchContext; rules: unknown; state: { sport?: unknown } | null }
export interface LivePlayerLine {
  contest_id: string; match_id: string | null; tournament_id: string; subject_key: string;
  team_id: string | null; team_player_id: string | null; user_id: string | null; raw: Record<string, number>;
}

export function livePlayerLines(rows: LiveContestRow[]): LivePlayerLine[] {
  return rows.flatMap((c) => {
    try {
      const { lines } = volleyballEngine.calculateStatistics(c.state!.sport as never, c.context, volleyballEngine.resolveRules(c.rules));
      return lines.filter((l) => l.subject === "player" && l.subjectKey).map((l) => ({
        contest_id: c.id, match_id: c.match_id, tournament_id: c.tournament_id, subject_key: l.subjectKey!,
        team_id: l.teamId, team_player_id: l.teamPlayerId, user_id: l.userId, raw: l.raw as Record<string, number>,
      }));
    } catch {
      return []; // an unreadable contest must not take the leaderboard down with it
    }
  });
}
