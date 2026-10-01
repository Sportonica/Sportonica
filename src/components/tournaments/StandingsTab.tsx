"use client";

import { useEffect, useState } from "react";
import { getTournamentStandings } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import type { Tournament, TournamentMatch, TournamentTeam, TournamentStanding } from "@/lib/tournaments/types";
import { basketballRulesOf, computeBasketballStandings, isBasketball, signed, standingsScheme, type BasketballStanding } from "@/lib/tournaments/standings";

const ALL = "__all__";

// Read-only. Football: tournament_standings() on the server. Basketball:
// computed from the fixtures with the competition's own table rules
// (see lib/tournaments/standings.ts). Used both embedded in the
// vendor/admin console and on the public tournament page, since
// standings carry no write actions either way.
export default function StandingsTab({ tournament, teams, matches }: {
  tournament: Tournament;
  teams: Pick<TournamentTeam, "id" | "name" | "status" | "group_name">[];
  matches?: TournamentMatch[];
}) {
  const groups = tournament.format === "group_knockout"
    ? [...new Set(teams.map((t) => t.group_name).filter((g): g is string => !!g))].sort()
    : [null];

  const basketball = isBasketball(tournament.sport) && !!matches;
  const scheme = standingsScheme(tournament.sport, tournament.scoring_rules);
  const [data, setData] = useState<Record<string, TournamentStanding[]>>({});
  const [loading, setLoading] = useState(!basketball);

  useEffect(() => {
    if (basketball) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const entries = await Promise.all(groups.map(async (g) => {
        const res = await getTournamentStandings(tournament.id, g ?? undefined);
        return [g ?? ALL, isActionError(res) ? [] : res] as const;
      }));
      if (!cancelled) setData(Object.fromEntries(entries));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id, tournament.format, groups.join("|"), basketball]);

  if (tournament.format === "knockout") {
    return <div className="tc-empty">Knockout tournaments don&apos;t track standings. See the Bracket tab.</div>;
  }
  if (loading) return <div className="tc-empty">Loading standings…</div>;

  const rowsFor = (g: string | null): (TournamentStanding & Partial<BasketballStanding>)[] =>
    basketball ? computeBasketballStandings(matches!, teams, tournament.scoring_rules, g) : data[g ?? ALL] ?? [];
  const anyPlayed = groups.some((g) => rowsFor(g).some((r) => r.played > 0));

  return (
    <div className="tc-card">
      <div className="tc-card-t">Standings</div>
      {basketball ? (
        <div className="tc-dim" style={{ fontSize: 12, marginTop: 4 }}>
          Ranked by table points, then {standingsTiebreakText(tournament.scoring_rules)}. A forfeit counts as a loss with no points for or against.
        </div>
      ) : null}
      {groups.map((g) => {
        const rows = rowsFor(g);
        return (
          <div key={g ?? ALL} style={{ marginTop: 16 }}>
            {g && <div className="tc-card-sub" style={{ fontWeight: 700, opacity: 0.8, marginBottom: 8 }}>Group {g}</div>}
            {rows.length === 0 || !anyPlayed ? (
              <div className="tc-empty">No results yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tc-table">
                  <thead>
                    <tr>
                      <th>Team</th><th>P</th><th>W</th>{scheme.draws && <th>D</th>}<th>L</th>
                      {basketball && <th title="Win percentage">Win %</th>}
                      <th title={scheme.forName}>{scheme.forLabel}</th>
                      <th title={scheme.againstName}>{scheme.againstLabel}</th>
                      <th title={scheme.diffName}>{scheme.diffLabel}</th>
                      {basketball && <th title="Current streak">Strk</th>}
                      {basketball && <th title="Last five games, most recent last">Last 5</th>}
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.team_id}>
                        <td style={{ fontWeight: 600 }}>{r.team_name}</td>
                        <td className="tc-num">{r.played}</td>
                        <td className="tc-num">{r.won}</td>
                        {scheme.draws && <td className="tc-num">{r.drawn}</td>}
                        <td className="tc-num">{r.lost}</td>
                        {basketball && <td className="tc-num">{r.win_pct === null || r.win_pct === undefined ? "–" : r.win_pct.toFixed(1)}</td>}
                        <td className="tc-num">{r.goals_for}</td>
                        <td className="tc-num">{r.goals_against}</td>
                        <td className="tc-num">{signed(r.goal_diff)}</td>
                        {basketball && <td className="tc-num">{r.streak || "–"}</td>}
                        {basketball && <td className="tc-num" style={{ letterSpacing: 1 }}>{r.last5 || "–"}</td>}
                        <td className="tc-num" style={{ fontWeight: 700 }}>{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function standingsTiebreakText(rules: unknown): string {
  return basketballRulesOf(rules).standingsTiebreak === "point_difference"
    ? "overall point difference, points scored, then games between the tied teams"
    : "games between the tied teams (points, difference, scored), then overall point difference";
}
