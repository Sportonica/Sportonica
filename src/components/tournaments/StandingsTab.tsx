"use client";

import { useEffect, useState } from "react";
import { getTournamentCricketStats, getTournamentStandings } from "@/lib/tournaments/actions";
import { getCricketMatchFacts, getCricketRecords } from "@/lib/intelligence/actions";
import { cricketPlayers, cricketTeams } from "@/lib/tournaments/cricketRecords";
import { CricketOverview, CricketTablePublic, type CricketTournamentData } from "./public/CricketStats";
import { isActionError } from "@/lib/actionError";
import type { Tournament, TournamentMatch, TournamentTeam, TournamentStanding } from "@/lib/tournaments/types";
import { basketballRulesOf, computeBasketballStandings, computeCricketStandings, cricketOutcome, cricketRulesOf, diffText, type CricketMatchFacts, type CricketStanding, isBasketball, isCricket, standingsScheme, type BasketballStanding } from "@/lib/tournaments/standings";

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
  const cricket = isCricket(tournament.sport) && !!matches;
  // computed here from the fixtures, with the sport's own rules (the rest come from tournament_standings())
  const computed = basketball || cricket;
  const scheme = standingsScheme(tournament.sport, tournament.scoring_rules);
  const [data, setData] = useState<Record<string, TournamentStanding[]>>({});
  const [loading, setLoading] = useState(!computed);
  // cricket: what the scored matches add (each match's overs, abandoned matches, who batted first),
  // and the player lines behind the overview: the same calculations as the public page
  const matchesKey = (matches ?? []).map((m) => `${m.id}:${m.updated_at}`).join("|");
  const teamsKey = teams.map((t) => `${t.id}:${t.name}:${t.status}`).join("|");
  const [quotas, setQuotas] = useState<CricketMatchFacts>({});
  const [cricketData, setCricketData] = useState<CricketTournamentData | null>(null);
  useEffect(() => {
    if (!cricket) return;
    let cancelled = false;
    void (async () => {
      const [f, rec, hand] = await Promise.all([getCricketMatchFacts(tournament.id), getCricketRecords(tournament.id), getTournamentCricketStats(tournament.id)]);
      if (cancelled) return;
      const facts = isActionError(f) ? {} : f;
      setQuotas(facts);
      const r = isActionError(rec) ? { lines: [], names: {}, partnerships: [] } : rec;
      const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "";
      setCricketData({
        players: cricketPlayers(r.lines, (pid, tid) => ({ name: r.names[pid]?.name ?? "Player", team: r.names[pid]?.team ?? teamName(tid) }), isActionError(hand) ? [] : hand),
        partnerships: r.partnerships, ...cricketTeams(matches!, teams, tournament.scoring_rules, facts),
      });
    })();
    return () => { cancelled = true; };
    // keyed on what the fixtures and teams contain, not on array identity, so a re-render never refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cricket, tournament.id, matchesKey, teamsKey, JSON.stringify(tournament.scoring_rules ?? null)]);

  useEffect(() => {
    if (computed) return;
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
  }, [tournament.id, tournament.format, groups.join("|"), computed]);

  if (tournament.format === "knockout") {
    return <div className="tc-empty">Knockout tournaments don&apos;t track standings. See the Bracket tab.</div>;
  }
  if (loading) return <div className="tc-empty">Loading standings…</div>;

  const rowsFor = (g: string | null): (TournamentStanding & Partial<BasketballStanding>)[] =>
    basketball ? computeBasketballStandings(matches!, teams, tournament.scoring_rules, g)
    : cricket ? computeCricketStandings(matches!, teams, tournament.scoring_rules, g, quotas)
    : data[g ?? ALL] ?? [];
  const anyPlayed = groups.some((g) => rowsFor(g).some((r) => r.played > 0));

  if (cricket) {
    const all = computeCricketStandings(matches!, teams, tournament.scoring_rules, null, quotas);
    const league = matches!.filter((m) => m.stage === "league" || m.stage === "group");
    const done = (m: (typeof league)[number]) => m.status === "completed" || m.status === "walkover" || !!quotas[m.id]?.abandoned;
    const name = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "TBD";
    const recent = matches!.filter((m) => m.status === "completed" && m.team_a_id && m.team_b_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4)
      .map((m) => ({
        text: `${name(m.team_a_id)} ${m.score_a ?? "–"}/${m.wickets_a ?? 0} v ${name(m.team_b_id)} ${m.score_b ?? "–"}/${m.wickets_b ?? 0}`,
        result: ((o) => (o === "a" || o === "b" ? `${name(o === "a" ? m.team_a_id : m.team_b_id)} won${m.score_a === m.score_b ? " the super over" : ""}` : o === "tie" ? "Tied" : "No result"))(cricketOutcome(m, quotas)),
      }));
    return (
      <div className="tc-card" style={{ display: "grid", gap: 16 }}>
        <div className="tc-card-t">Overview</div>
        {cricketData ? (
          <CricketOverview data={cricketData} standings={all} played={league.filter(done).length}
            remaining={league.filter((m) => !done(m) && m.status !== "cancelled").length} recent={recent} />
        ) : <div className="tc-empty">Loading…</div>}
        <div className="tc-card-t">Standings</div>
        {anyPlayed ? (
          <CricketTablePublic table={cricketRulesOf(tournament.scoring_rules).table} logo={() => null}
            groups={groups.map((g) => ({ name: g, rows: rowsFor(g) as CricketStanding[] }))} />
        ) : <div className="tc-empty">No results yet.</div>}
      </div>
    );
  }

  return (
    <div className="tc-card">
      <div className="tc-card-t">Standings</div>
      {basketball ? (
        <div className="tc-dim" style={{ fontSize: 12, marginTop: 4 }}>
          Ranked by table points, then {standingsTiebreakText(tournament.scoring_rules)}. A forfeit counts as a loss with no points for or against.
        </div>
      ) : cricket ? (
        <div className="tc-dim" style={{ fontSize: 12, marginTop: 4 }}>
          2 points for a win, 1 for a tie or no result. Ranked by points, then net run rate (a side bowled out counts its full overs).
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
                <table className="tc-table tc-standings">
                  <thead>
                    <tr>
                      <th>Team</th><th>P</th><th>W</th><th>L</th>{scheme.draws && <th title={scheme.drawName}>{scheme.drawLabel ?? "D"}</th>}
                      {basketball && <th className="tc-sm-hide" title="Win percentage">Win %</th>}
                      <th className="tc-sm-hide" title={scheme.forName}>{scheme.forLabel}</th>
                      <th className="tc-sm-hide" title={scheme.againstName}>{scheme.againstLabel}</th>
                      <th title={scheme.diffName}>{scheme.diffLabel}</th>
                      {basketball && <th className="tc-sm-hide" title="Current streak">Strk</th>}
                      {basketball && <th className="tc-sm-hide" title="Last five games, most recent last">Last 5</th>}
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.team_id}>
                        <td style={{ fontWeight: 600 }}>{r.team_name}</td>
                        <td className="tc-num">{r.played}</td>
                        <td className="tc-num">{r.won}</td>
                        <td className="tc-num">{r.lost}</td>
                        {scheme.draws && <td className="tc-num">{r.drawn}</td>}
                        {basketball && <td className="tc-num tc-sm-hide">{r.win_pct === null || r.win_pct === undefined ? "–" : r.win_pct.toFixed(1)}</td>}
                        <td className="tc-num tc-sm-hide">{r.goals_for}</td>
                        <td className="tc-num tc-sm-hide">{r.goals_against}</td>
                        <td className="tc-num">{diffText(scheme, r.goal_diff)}</td>
                        {basketball && <td className="tc-num tc-sm-hide">{r.streak || "–"}</td>}
                        {basketball && <td className="tc-num tc-sm-hide" style={{ letterSpacing: 1 }}>{r.last5 || "–"}</td>}
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
