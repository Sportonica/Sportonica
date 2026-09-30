"use client";

// The public match centre. Basic information first (the score card),
// with deeper statistics and analytics a tab away.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getContestEvents, getContestIntelligence, getRacePerformance, getTournamentLeaders } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { formatDuration } from "@/lib/intelligence/core/util";
import type { ContestIntelligence, ContestView, TimelineEntry, TournamentLeaders } from "@/lib/intelligence/types";
import type { SwimPerformance } from "@/lib/intelligence/sports/swimming";
import { useLiveContest } from "./useLiveContest";
import { ChartView, ScoreCard, StatCards, StatTableView, Timeline } from "./views";
import "./intelligence.css";

const TABS = ["Live", "Timeline", "Statistics", "Players", "Analytics", "History"] as const;
type Tab = (typeof TABS)[number];

export default function MatchCentre({ initial, tournamentName, canScore }: { initial: ContestView; tournamentName: string; canScore: boolean }) {
  const [contest] = useLiveContest(initial);
  const [tab, setTab] = useState<Tab>("Live");
  const [intel, setIntel] = useState<ContestIntelligence | null>(null);
  const [events, setEvents] = useState<{ entries: TimelineEntry[]; hasMore: boolean } | null>(null);
  const [leaders, setLeaders] = useState<TournamentLeaders | null | undefined>(undefined);
  const [perf, setPerf] = useState<Record<string, SwimPerformance>>({});
  const [error, setError] = useState<string | null>(null);

  // statistics and the timeline follow the score: refetch when a new event lands
  useEffect(() => {
    let stale = false;
    (async () => {
      if (tab === "Timeline") {
        const res = await getContestEvents(contest.id, { limit: 50 });
        if (stale) return;
        if (isActionError(res)) setError(res.message); else setEvents(res);
      } else if (tab === "History") {
        const [l, p] = await Promise.all([getTournamentLeaders(contest.tournamentId), contest.sport === "swimming" ? getRacePerformance(contest.id) : Promise.resolve({})]);
        if (stale) return;
        setLeaders(isActionError(l) ? null : l);
        if (!isActionError(p)) setPerf(p);
      } else {
        const res = await getContestIntelligence(contest.id);
        if (stale) return;
        if (isActionError(res)) setError(res.message); else setIntel(res);
      }
    })();
    return () => { stale = true; };
  }, [tab, contest.id, contest.lastSeq, contest.tournamentId, contest.sport]);

  async function loadMore() {
    if (!events?.entries.length) return;
    const res = await getContestEvents(contest.id, { limit: 50, before: events.entries[events.entries.length - 1].seq });
    if (!isActionError(res)) setEvents({ entries: [...events.entries, ...res.entries], hasMore: res.hasMore });
  }

  const lanes = contest.summary.view.lanes ?? [];

  return (
    <div className="si">
      <div className="si-wrap si-grid">
        <div>
          <Link href={`/tournaments/${contest.tournamentId}`} className="si-back"><ChevronLeft size={16} /> {tournamentName}</Link>
          <h1 className="si-h1">{contest.label ?? "Match centre"}</h1>
        </div>

        <ScoreCard summary={contest.summary} context={contest.context} />

        {canScore ? (
          <div className="si-row">
            <Link className="si-btn primary" href={`/tournaments/${contest.tournamentId}/score/${contest.id}`}>Open scorer</Link>
          </div>
        ) : null}

        <div className="si-tabs" role="tablist">
          {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`si-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
        </div>

        {error ? <div className="si-error">{error}</div> : null}

        {tab === "Live" ? (
          <>
            <div className="si-card">
              <h2 className="si-h2">At a glance</h2>
              <div className="si-notes">{contest.summary.lines.map((l, i) => <span key={i}>{l}</span>)}</div>
            </div>
            {intel ? <StatCards cards={intel.analytics.cards} /> : null}
            {intel?.teams[0] ? <StatTableView table={intel.teams[0]} max={8} /> : null}
          </>
        ) : null}

        {tab === "Timeline" ? (
          <div className="si-card">
            <h2 className="si-h2">Event timeline</h2>
            {events ? <Timeline entries={events.entries} /> : <div className="si-muted">Loading…</div>}
            {events?.hasMore ? <button type="button" className="si-btn small" style={{ marginTop: 10 }} onClick={loadMore}>Show earlier events</button> : null}
          </div>
        ) : null}

        {tab === "Statistics" ? (
          intel ? (intel.teams.length ? intel.teams.map((t) => <StatTableView key={t.key} table={t} />) : intel.players.slice(0, 1).map((t) => <StatTableView key={t.key} table={t} />)) : <div className="si-muted">Loading…</div>
        ) : null}

        {tab === "Players" ? (
          intel ? intel.players.map((t) => <StatTableView key={t.key} table={t} />) : <div className="si-muted">Loading…</div>
        ) : null}

        {tab === "Analytics" ? (
          intel ? (
            <>
              <StatCards cards={intel.analytics.cards} />
              {intel.analytics.charts.map((c) => <ChartView key={c.key} chart={c} />)}
              {intel.analytics.tables.map((t) => <StatTableView key={t.key} table={t} />)}
            </>
          ) : <div className="si-muted">Loading…</div>
        ) : null}

        {tab === "History" ? (
          <>
            {contest.sport === "swimming" && lanes.length ? (
              <div className="si-card">
                <h2 className="si-h2">Against personal bests</h2>
                {Object.keys(perf).length ? (
                  <div className="si-table-wrap">
                    <table className="si-table">
                      <thead><tr><th>Swimmer</th><th>Time</th><th>Previous best</th><th>Difference</th><th>Season best</th><th>Improvement</th><th className="text">Note</th></tr></thead>
                      <tbody>
                        {lanes.filter((l) => perf[String(l.lane)]).map((l) => {
                          const p = perf[String(l.lane)];
                          return (
                            <tr key={l.lane}>
                              <td>{l.name}</td>
                              <td>{l.time}</td>
                              <td>{p.personalBestMs === null ? <span className="na">n/a</span> : formatDuration(p.personalBestMs)}</td>
                              <td>{p.diffFromPersonalBestMs === null ? <span className="na">n/a</span> : `${p.diffFromPersonalBestMs > 0 ? "+" : ""}${formatDuration(p.diffFromPersonalBestMs)}`}</td>
                              <td>{p.seasonBestMs === null ? <span className="na">n/a</span> : formatDuration(p.seasonBestMs)}</td>
                              <td>{p.improvementPct === null ? <span className="na">n/a</span> : `${p.improvementPct}%`}</td>
                              <td className="text">{p.personalBestMs === null ? "First recorded swim" : p.isPersonalBest ? "Personal best" : p.isSeasonBest ? "Season best" : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="si-muted">Comparisons appear once the race is completed.</div>}
              </div>
            ) : null}
            {leaders === undefined ? <div className="si-muted">Loading…</div> : leaders && leaders.rows.length ? (
              <StatTableView table={{
                key: "leaders", title: "This tournament so far (completed matches)",
                columns: leaders.columns,
                rows: leaders.rows.map((r) => ({ id: r.subjectKey, name: r.teamName && r.teamName !== r.name ? `${r.name} (${r.teamName})` : r.name, side: null, values: r.values })),
              }} />
            ) : <div className="si-info">Tournament totals appear here once a match has been completed.</div>}
          </>
        ) : null}
      </div>
    </div>
  );
}
