"use client";

// Cricket's tournament views: the points table, leaderboards, records,
// team statistics and the organiser's overview. All of them read the same
// calculations (lib/tournaments/standings.ts and cricketRecords.ts), so
// the public page and the console can never disagree.

import { useState } from "react";
import type { CricketStanding, CricketResult } from "@/lib/tournaments/standings";
import { oversOf } from "@/lib/tournaments/standings";
import { inningsText, type CricketPlayer, type CricketTeamStats, type PartnershipRecord, type TeamInnings } from "@/lib/tournaments/cricketRecords";
import { TIEBREAKER_LABEL, type CricketTable } from "@/lib/intelligence/sports/cricketTable";
import "./cricket-stats.css";

export interface CricketTournamentData {
  players: CricketPlayer[];
  partnerships: PartnershipRecord[];
  teams: CricketTeamStats[];
  innings: TeamInnings[];
}

const nrrText = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(3)}`;
const dec = (n: number | null, d = 2) => (n === null ? "–" : n.toFixed(d));

export function tableRulesText(t: CricketTable): string {
  const pts = [`${t.win} for a win`, t.tie === t.noResult ? `${t.tie} for a tie or no result` : `${t.tie} for a tie, ${t.noResult} for no result`, `${t.loss} for a loss`];
  const tb = t.tiebreakers.length ? ` Level on points: ${t.tiebreakers.map((x) => TIEBREAKER_LABEL[x]).join(", then ")}.` : "";
  const q = t.qualifiers ? ` Top ${t.qualifiers} go through.` : "";
  return `${pts.join(", ")}.${tb}${q} A side bowled out is charged its full overs in net run rate.`;
}

export function Form({ form }: { form: CricketResult[] }) {
  if (!form.length) return <span className="cs-muted">–</span>;
  return (
    <span className="cs-form" aria-label={`Last ${form.length}: ${form.join(" ")}`}>
      {form.map((r, i) => <i key={i} className={`r-${r}`}>{r === "N" ? "NR" : r}</i>)}
    </span>
  );
}

const STATUS: Record<string, string> = { qualified: "Qualified", eliminated: "Eliminated", contention: "In contention" };
export function StatusBadge({ status }: { status: CricketStanding["status"] }) {
  return status ? <span className={`cs-status ${status}`}>{STATUS[status]}</span> : null;
}

// ── points table (public) ───────────────────────────────────────

export function CricketTablePublic({ groups, logo, table }: {
  groups: { name: string | null; rows: CricketStanding[] }[]; logo: (teamId: string) => string | null; table: CricketTable;
}) {
  return (
    <div className="cs">
      {groups.map((g) => (
        <section key={g.name ?? "all"} className="cs-block">
          {g.name ? <h3 className="cs-h">Group {g.name}</h3> : null}
          <div className="cs-table" role="table" aria-label={g.name ? `Group ${g.name} standings` : "Standings"}>
            <div className="cs-tr head" role="row">
              <span>#</span><span>Team</span><span>P</span><span>W</span><span>L</span><span className="wide">T</span><span className="wide">NR</span><span>Pts</span><span>NRR</span><span className="wide">Form</span>
            </div>
            {g.rows.map((r, i) => {
              const src = logo(r.team_id);
              return (
                <details key={r.team_id} className={`cs-row${table.qualifiers && i < table.qualifiers ? " in" : ""}`}>
                  <summary className="cs-tr" role="row">
                    <span className="cs-rank">{i + 1}</span>
                    <span className="cs-team">
                      <span className="cs-badge">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {src ? <img src={src} alt="" /> : r.team_name.charAt(0).toUpperCase()}
                      </span>
                      <span className="cs-team-name">{r.team_name}<StatusBadge status={r.status} /></span>
                    </span>
                    <span>{r.played}</span><span>{r.won}</span><span>{r.lost}</span>
                    <span className="wide">{r.tied}</span><span className="wide">{r.no_result}</span>
                    <span className="cs-pts">{r.points}</span>
                    <span className="cs-nrr">{r.nrr_games ? nrrText(r.goal_diff) : "–"}</span>
                    <span className="wide"><Form form={r.form} /></span>
                  </summary>
                  <div className="cs-more">
                    <div><span>Tied · No result</span><b>{r.tied} · {r.no_result}</b></div>
                    <div><span>Form</span><b><Form form={r.form} /></b></div>
                    <div><span>Runs for</span><b>{r.goals_for} <small>in {oversOf(r.balls_faced)} ov</small></b></div>
                    <div><span>Runs against</span><b>{r.goals_against} <small>in {oversOf(r.balls_bowled)} ov</small></b></div>
                    <div><span>Matches left</span><b>{r.remaining}</b></div>
                    <div><span>Most points possible</span><b>{r.max_points}</b></div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
      <p className="cs-note">{tableRulesText(table)} Tap a team for more.</p>
    </div>
  );
}

// ── leaderboards ────────────────────────────────────────────────

// a rate needs enough of a sample to mean anything
export const SR_MIN_BALLS = 10, ECON_MIN_BALLS = 12, AVG_MIN_INNINGS = 2;

type Stat = { key: string; label: string; group: "Batting" | "Bowling" | "Fielding"; value: (p: CricketPlayer) => number | null; shown: (p: CricketPlayer) => string; asc?: boolean; note?: string; sub?: (p: CricketPlayer) => string };
const hs = (p: CricketPlayer) => (p.highest ? `${p.highest.runs}${p.highest.notOut ? "*" : ""}` : "–");
const bb = (p: CricketPlayer) => (p.best ? `${p.best.wickets}/${p.best.runs}` : "–");

export const CRICKET_STATS: Stat[] = [
  { key: "runs", label: "Most runs", group: "Batting", value: (p) => p.runs || null, shown: (p) => String(p.runs), sub: (p) => `${p.innings || p.matches} inn · HS ${hs(p)}` },
  { key: "hs", label: "Highest score", group: "Batting", value: (p) => p.highest?.runs ?? null, shown: hs, sub: (p) => `${p.runs} runs in all` },
  { key: "avg", label: "Best average", group: "Batting", value: (p) => (p.innings >= AVG_MIN_INNINGS ? p.average : null), shown: (p) => dec(p.average), note: `Runs per dismissal, ${AVG_MIN_INNINGS}+ innings.`, sub: (p) => `${p.runs} runs, ${p.innings - p.notOuts} outs` },
  { key: "sr", label: "Best strike rate", group: "Batting", value: (p) => (p.balls >= SR_MIN_BALLS ? p.strikeRate : null), shown: (p) => dec(p.strikeRate), note: `Runs per 100 balls, ${SR_MIN_BALLS}+ balls faced.`, sub: (p) => `${p.runs} off ${p.balls}` },
  { key: "fifties", label: "Most 50s", group: "Batting", value: (p) => p.fifties + p.hundreds || null, shown: (p) => String(p.fifties + p.hundreds), sub: (p) => `${p.fifties} fifties, ${p.hundreds} hundreds` },
  { key: "hundreds", label: "Most 100s", group: "Batting", value: (p) => p.hundreds || null, shown: (p) => String(p.hundreds) },
  { key: "fours", label: "Most 4s", group: "Batting", value: (p) => p.fours || null, shown: (p) => String(p.fours) },
  { key: "sixes", label: "Most 6s", group: "Batting", value: (p) => p.sixes || null, shown: (p) => String(p.sixes) },
  { key: "wickets", label: "Most wickets", group: "Bowling", value: (p) => p.wickets || null, shown: (p) => String(p.wickets), sub: (p) => `Best ${bb(p)}${p.economy !== null ? ` · econ ${dec(p.economy)}` : ""}` },
  { key: "bb", label: "Best bowling", group: "Bowling", value: (p) => (p.best && p.best.wickets ? p.best.wickets * 1000 - p.best.runs : null), shown: bb, sub: (p) => `${p.wickets} wickets in all` },
  { key: "econ", label: "Best economy", group: "Bowling", value: (p) => (p.bowlBalls >= ECON_MIN_BALLS ? p.economy : null), shown: (p) => dec(p.economy), asc: true, note: `Runs per over, ${ECON_MIN_BALLS / 6}+ overs scored ball by ball. Lowest first.`, sub: (p) => `${oversOf(p.bowlBalls)} ov, ${p.bowlRuns} runs` },
  { key: "bowlAvg", label: "Best bowling average", group: "Bowling", value: (p) => (p.wickets >= 2 ? p.bowlAverage : null), shown: (p) => dec(p.bowlAverage), asc: true, note: "Runs per wicket, 2+ wickets. Lowest first." },
  { key: "maidens", label: "Most maidens", group: "Bowling", value: (p) => p.maidens || null, shown: (p) => String(p.maidens) },
  { key: "hauls", label: "Most 3+ wicket hauls", group: "Bowling", value: (p) => p.threeFors + p.fiveFors || null, shown: (p) => String(p.threeFors + p.fiveFors) },
  { key: "fivefors", label: "Most 5-wicket hauls", group: "Bowling", value: (p) => p.fiveFors || null, shown: (p) => String(p.fiveFors) },
  { key: "catches", label: "Most catches", group: "Fielding", value: (p) => p.catches || null, shown: (p) => String(p.catches) },
  { key: "mom", label: "Player of the match", group: "Fielding", value: (p) => p.mom || null, shown: (p) => String(p.mom) },
];

export function rankPlayers(players: CricketPlayer[], key: string) {
  const st = CRICKET_STATS.find((s) => s.key === key)!;
  return players.map((p) => ({ p, v: st.value(p) })).filter((x): x is { p: CricketPlayer; v: number } => x.v !== null)
    .sort((a, b) => (st.asc ? a.v - b.v : b.v - a.v) || a.p.name.localeCompare(b.p.name))
    .map(({ p }) => ({ p, shown: st.shown(p), sub: st.sub?.(p) ?? p.team }));
}

const GROUPS = ["Batting", "Bowling", "Fielding", "Teams", "Records"] as const;

export function CricketLeaders({ data }: { data: CricketTournamentData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("Batting");
  const [stat, setStat] = useState("runs");
  const stats = CRICKET_STATS.filter((s) => s.group === group);
  const pickGroup = (g: (typeof GROUPS)[number]) => { setGroup(g); const first = CRICKET_STATS.find((s) => s.group === g); if (first) setStat(first.key); };
  const st = CRICKET_STATS.find((s) => s.key === stat);
  const rows = st && st.group === group ? rankPlayers(data.players, stat) : [];
  return (
    <div className="cs">
      <div className="cs-seg" role="tablist">
        {GROUPS.map((g) => <button key={g} role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => pickGroup(g)}>{g}</button>)}
      </div>
      {group === "Teams" ? <TeamStats data={data} /> : group === "Records" ? <Records data={data} /> : (
        <>
          <div className="cs-chips">
            {stats.map((s) => <button key={s.key} className={`cs-chip${stat === s.key ? " on" : ""}`} onClick={() => setStat(s.key)}>{s.label}</button>)}
          </div>
          {st?.note ? <p className="cs-note">{st.note}</p> : null}
          {!rows.length ? <div className="cs-empty">Nothing recorded for this yet.</div> : (
            <ol className="cs-board">
              {rows.map(({ p, shown, sub }, i) => (
                <li key={p.id} className={i === 0 ? "first" : ""}>
                  <span className="cs-rank">{i + 1}</span>
                  <span className="cs-who"><b>{p.name}</b><small>{p.team}{sub && sub !== p.team ? ` · ${sub}` : ""}</small></span>
                  <span className="cs-val">{shown}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// ── team statistics ─────────────────────────────────────────────

function TeamStats({ data }: { data: CricketTournamentData }) {
  const teams = data.teams.filter((t) => t.played > 0).sort((a, b) => b.won - a.won || b.runs - a.runs);
  if (!teams.length) return <div className="cs-empty">Team statistics appear once matches are played.</div>;
  return (
    <div className="cs-teams">
      {teams.map((t) => (
        <details key={t.teamId} className="cs-teamcard">
          <summary>
            <b>{t.team}</b>
            <span className="cs-wl">{t.won}W {t.lost}L{t.tied ? ` ${t.tied}T` : ""}{t.noResult ? ` ${t.noResult}NR` : ""}</span>
            <span className="cs-muted">{t.played} played</span>
          </summary>
          <div className="cs-more">
            <div><span>Total runs</span><b>{t.runs}</b></div>
            <div><span>Average score</span><b>{dec(t.average, 1)}</b></div>
            <div><span>Highest score</span><b>{t.highest ? inningsText(t.highest) : "–"}{t.highest ? <small> v {t.highest.opponent}</small> : null}</b></div>
            <div><span>Lowest score</span><b>{t.lowest ? inningsText(t.lowest) : "–"}{t.lowest ? <small> v {t.lowest.opponent}</small> : null}</b></div>
            <div><span>Best chase</span><b>{t.bestChase ? inningsText(t.bestChase) : "–"}{t.bestChase ? <small> v {t.bestChase.opponent}</small> : null}</b></div>
            <div><span>Biggest win</span><b>{[t.biggestWinRuns !== null ? `${t.biggestWinRuns} runs` : null, t.biggestWinWickets !== null ? `${t.biggestWinWickets} wkts` : null].filter(Boolean).join(" · ") || "–"}</b></div>
          </div>
        </details>
      ))}
    </div>
  );
}

// ── records ─────────────────────────────────────────────────────

type Rec = { label: string; value: string; who: string; detail?: string };

export function tournamentRecords(data: CricketTournamentData, standings: CricketStanding[] = []): { batting: Rec[]; bowling: Rec[]; team: Rec[] } {
  const top = (key: string) => rankPlayers(data.players, key)[0];
  const rec = (label: string, key: string): Rec | null => { const t = top(key); return t ? { label, value: t.shown, who: t.p.name, detail: t.p.team } : null; };
  const inns = data.innings;
  const hi = [...inns].sort((a, b) => b.runs - a.runs)[0];
  // a lowest total is a completed innings: never a successful chase that stopped early
  const lo = [...inns].filter((i) => !(i.chasing && i.won)).sort((a, b) => a.runs - b.runs)[0];
  const chase = [...inns].filter((i) => i.chasing && i.won).sort((a, b) => b.runs - a.runs)[0];
  const winRuns = [...data.teams].filter((t) => t.biggestWinRuns !== null).sort((a, b) => b.biggestWinRuns! - a.biggestWinRuns!)[0];
  const winWkts = [...data.teams].filter((t) => t.biggestWinWickets !== null).sort((a, b) => b.biggestWinWickets! - a.biggestWinWickets!)[0];
  const bestNrr = standings.filter((s) => s.nrr_games).sort((a, b) => b.goal_diff - a.goal_diff)[0];
  const stand = data.partnerships[0];
  const clean = (xs: (Rec | null)[]) => xs.filter((x): x is Rec => !!x);
  return {
    batting: clean([rec("Top run scorer", "runs"), rec("Highest score", "hs"), rec("Best strike rate", "sr"), rec("Most sixes", "sixes"), rec("Most fours", "fours"),
      stand ? { label: "Highest partnership", value: `${stand.runs}`, who: stand.batters.join(" & "), detail: `${stand.team} v ${stand.opponent}, ${stand.balls} balls` } : null]),
    bowling: clean([rec("Top wicket taker", "wickets"), rec("Best bowling", "bb"), rec("Best economy", "econ"), rec("Most maidens", "maidens")]),
    team: clean([
      hi ? { label: "Highest score", value: inningsText(hi), who: hi.team, detail: `v ${hi.opponent}` } : null,
      lo ? { label: "Lowest score", value: inningsText(lo), who: lo.team, detail: `v ${lo.opponent}` } : null,
      chase ? { label: "Highest successful chase", value: inningsText(chase), who: chase.team, detail: `v ${chase.opponent}` } : null,
      winRuns ? { label: "Biggest win (runs)", value: `${winRuns.biggestWinRuns} runs`, who: winRuns.team } : null,
      winWkts ? { label: "Biggest win (wickets)", value: `${winWkts.biggestWinWickets} wickets`, who: winWkts.team } : null,
      bestNrr ? { label: "Best net run rate", value: nrrText(bestNrr.goal_diff), who: bestNrr.team_name } : null,
    ]),
  };
}

function Records({ data }: { data: CricketTournamentData }) {
  const r = tournamentRecords(data);
  if (!r.batting.length && !r.bowling.length && !r.team.length) return <div className="cs-empty">Records appear once matches are played.</div>;
  return (
    <div className="cs-records">
      {([["Batting", r.batting], ["Bowling", r.bowling], ["Team", r.team]] as const).map(([title, list]) => list.length ? (
        <section key={title}>
          <h3 className="cs-h">{title}</h3>
          <dl className="cs-recs">
            {list.map((x) => (
              <div key={x.label}>
                <dt>{x.label}</dt>
                <dd><b>{x.value}</b><span>{x.who}{x.detail ? <small> · {x.detail}</small> : null}</span></dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null)}
      {data.partnerships.length > 1 ? (
        <section>
          <h3 className="cs-h">Highest partnerships</h3>
          <ol className="cs-board">
            {data.partnerships.slice(0, 5).map((p, i) => (
              <li key={i}><span className="cs-rank">{i + 1}</span><span className="cs-who"><b>{p.batters.join(" & ")}</b><small>{p.team} v {p.opponent} · wicket {p.wicket} · {p.balls} balls</small></span><span className="cs-val">{p.runs}</span></li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

// ── organiser overview ──────────────────────────────────────────

export function CricketOverview({ data, standings, played, remaining, recent }: {
  data: CricketTournamentData; standings: CricketStanding[]; played: number; remaining: number; recent: { text: string; result: string | null }[];
}) {
  const r = tournamentRecords(data, standings);
  const find = (list: Rec[], label: string) => list.find((x) => x.label === label);
  const leader = standings[0];
  const tiles: [string, string, string | undefined][] = [
    ["Matches played", String(played), `${remaining} to play`],
    ["Leader", leader && leader.played ? leader.team_name : "–", leader && leader.played ? `${leader.points} pts · NRR ${nrrText(leader.goal_diff)}` : undefined],
    ["Top run scorer", find(r.batting, "Top run scorer")?.who ?? "–", find(r.batting, "Top run scorer")?.value ? `${find(r.batting, "Top run scorer")!.value} runs` : undefined],
    ["Top wicket taker", find(r.bowling, "Top wicket taker")?.who ?? "–", find(r.bowling, "Top wicket taker")?.value ? `${find(r.bowling, "Top wicket taker")!.value} wickets` : undefined],
    ["Highest score", find(r.team, "Highest score")?.value ?? "–", find(r.team, "Highest score")?.who],
    ["Best NRR", find(r.team, "Best net run rate")?.value ?? "–", find(r.team, "Best net run rate")?.who],
  ];
  return (
    <div className="cs">
      <div className="cs-tiles">
        {tiles.map(([l, v, sub]) => <div key={l}><span>{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</div>)}
      </div>
      {recent.length ? (
        <div className="cs-recent">
          <span className="cs-h">Recent results</span>
          {recent.map((x, i) => <div key={i}><span>{x.text}</span>{x.result ? <small>{x.result}</small> : null}</div>)}
        </div>
      ) : null}
    </div>
  );
}
