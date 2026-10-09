"use client";

// The public cricket match centre. Read-only: what is happening now
// first, then the scorecard, commentary, charts and squads. The score
// follows the scorer live (useLiveContest), with no page reload.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getContestEvents, getContestIntelligence } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import type { ContestIntelligence, ContestView, TimelineEntry } from "@/lib/intelligence/types";
import type { CricketRules, CricketState } from "@/lib/intelligence/sports/cricket";
import {
  liveNumbers, latestInnings, openInnings, playerMatchLine, sideScores, topPerformers, fmt,
} from "@/lib/intelligence/sports/cricketView";
import { useLiveContest } from "../useLiveContest";
import { ChartView, StatTableView, StatusPill } from "../views";
import { Balls, BattersPanel, BowlerPanel, Commentary, LivePartnership, OversList, Scorecard, commentaryFrom } from "./parts";
import "../intelligence.css";

const TABS = ["Overview", "Scorecard", "Commentary", "Stats", "Players"] as const;
type Tab = (typeof TABS)[number];

export default function CricketMatchCentre({ initial, tournamentName, canScore }: { initial: ContestView; tournamentName: string; canScore: boolean }) {
  const [contest] = useLiveContest(initial);
  const [tab, setTab] = useState<Tab>("Overview");
  const [events, setEvents] = useState<{ entries: TimelineEntry[]; hasMore: boolean } | null>(null);
  const [intel, setIntel] = useState<ContestIntelligence | null>(null);
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;

  // commentary and charts follow the score: refetch when a new event lands
  useEffect(() => {
    let stale = false;
    (async () => {
      if (tab === "Overview" || tab === "Commentary") {
        const res = await getContestEvents(contest.id, { limit: tab === "Overview" ? 40 : 150 });
        if (!stale && !isActionError(res)) setEvents(res);
      } else if (tab === "Stats") {
        const res = await getContestIntelligence(contest.id);
        if (!stale && !isActionError(res)) setIntel(res);
      }
    })();
    return () => { stale = true; };
  }, [tab, contest.id, contest.lastSeq]);

  async function loadMore() {
    if (!events?.entries.length) return;
    const res = await getContestEvents(contest.id, { limit: 150, before: events.entries[events.entries.length - 1].seq });
    if (!isActionError(res)) setEvents({ entries: [...events.entries, ...res.entries], hasMore: res.hasMore });
  }

  const items = useMemo(() => commentaryFrom(events?.entries ?? [], ctx), [events, ctx]);

  return (
    <div className="si">
      <div className="si-wrap si-grid">
        <div>
          <Link href={`/tournaments/${contest.tournamentId}`} className="si-back"><ChevronLeft size={16} /> {tournamentName}</Link>
          {contest.label ? <div className="ck-muted" style={{ fontSize: 13, fontWeight: 700 }}>{contest.label}</div> : null}
        </div>

        <MatchHeader contest={contest} />

        {canScore ? (
          <div className="si-row">
            <Link className="si-btn primary" href={`/tournaments/${contest.tournamentId}/score/${contest.id}`}>Open scorer</Link>
          </div>
        ) : null}

        <div className="si-tabs" role="tablist">
          {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`si-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
        </div>

        {tab === "Overview" ? <Overview contest={contest} items={items} onAll={() => setTab("Commentary")} /> : null}
        {tab === "Scorecard" ? <Scorecard state={s} ctx={ctx} rules={rules} /> : null}
        {tab === "Commentary" ? (
          <section className="ck-panel">
            {events ? <Commentary items={items} /> : <div className="ck-muted">Loading…</div>}
            {events?.hasMore ? <button type="button" className="si-btn small" style={{ marginTop: 10 }} onClick={loadMore}>Show earlier balls</button> : null}
          </section>
        ) : null}
        {tab === "Stats" ? <Stats intel={intel} /> : null}
        {tab === "Players" ? <Players contest={contest} /> : null}
      </div>
    </div>
  );
}

function MatchHeader({ contest }: { contest: ContestView }) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  // a match ended before its innings closed (rain, a declared result) has no one batting
  const over = contest.status !== "live" && contest.status !== "paused";
  const live = over ? null : openInnings(s);
  const n = live ? liveNumbers(live, rules) : null;
  const rows = sideScores(s, ctx, rules).map((r) => (over ? { ...r, batting: false } : r));
  const decided = contest.summary.resultText;
  const winner = (contest.summary.result ?? s.result)?.winner;
  return (
    <section className="ck-match" aria-live="polite">
      <div className="ck-head-top">
        <span className="ck-sport">Cricket</span>
        <StatusPill status={contest.status} />
        {live ? <span className="ck-muted ck-period">{contest.summary.view.periodLabel}</span> : null}
      </div>
      <div className="ck-match-sides">
        {rows.map((r) => (
          <div key={r.side} className={`ck-match-side${r.batting ? " batting" : ""}${winner === r.side ? " won" : ""}`}>
            <span className="ck-match-name">{r.batting ? <i className="ck-dot" aria-label="Batting" /> : null}{r.name}</span>
            <span className="ck-match-score">{r.score ?? <span className="ck-muted">Yet to bat</span>}</span>
            <span className="ck-match-overs">{r.overs ? `${r.overs} ov` : ""}</span>
          </div>
        ))}
      </div>
      {n ? (
        <div className="ck-live-rates">
          <span><i>CRR</i>{fmt(n.crr)}</span>
          {n.target !== null ? <><span><i>Target</i>{n.target}</span>{n.rrr !== null ? <span><i>RRR</i>{fmt(n.rrr)}</span> : null}</> : null}
          {live!.freeHit ? <span className="ck-free">FREE HIT</span> : null}
        </div>
      ) : null}
      {n && n.need !== null ? (
        <div className="ck-need">Need {n.need} run{n.need === 1 ? "" : "s"}{n.ballsLeft !== null ? ` from ${n.ballsLeft} ball${n.ballsLeft === 1 ? "" : "s"}` : ""}</div>
      ) : null}
      {s.superOvers?.length ? (
        <div className="ck-super">
          {Array.from({ length: Math.ceil(s.superOvers.length / 2) }, (_, k) => s.superOvers!.slice(k * 2, k * 2 + 2)).map((pair, k, all) => (
            <div key={k}>
              <span className="ck-label">{all.length > 1 ? `Super over ${k + 1}` : "Super over"}</span>
              {pair.map((i) => <span key={i.n}>{ctx.sides?.[i.batting].name} <b>{i.runs}/{i.wickets}</b>{i.closed ? "" : ` (${i.balls} ball${i.balls === 1 ? "" : "s"})`}</span>)}
            </div>
          ))}
        </div>
      ) : null}
      {decided ? <div className="ck-result">{decided}</div> : null}
      {contest.summary.statusReason ? <div className="si-reason">{contest.summary.statusReason}</div> : null}
    </section>
  );
}

function Overview({ contest, items, onAll }: { contest: ContestView; items: ReturnType<typeof commentaryFrom>; onAll: () => void }) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  const live = contest.status === "live" || contest.status === "paused" ? openInnings(s) : null;
  const last = latestInnings(s);
  const recent = last ? last.overs.slice(-2).flatMap((o) => o.balls) : [];

  if (!last) {
    return (
      <section className="ck-panel">
        <div className="ck-panel-head"><h3>Before the first ball</h3></div>
        <p className="ck-muted" style={{ margin: 0 }}>
          {s.toss ? `${ctx.sides?.[s.toss.winner].name} won the toss and chose to ${s.toss.decision}. ` : ""}
          The live score, batters and bowler appear here as soon as play starts.
        </p>
      </section>
    );
  }

  return (
    <div className="ck-overview">
      {s.result || contest.status === "completed" ? <ResultCard contest={contest} /> : null}
      {live ? (
        <div className="ck-pad-info">
          <BattersPanel inn={live} ctx={ctx} />
          <BowlerPanel inn={live} ctx={ctx} rules={rules} />
        </div>
      ) : null}
      <div className="ck-pad-info">
        {live ? <LivePartnership inn={live} ctx={ctx} rules={rules} /> : null}
        {recent.length ? (
          <section className="ck-panel">
            <div className="ck-panel-head"><h3>Recent balls</h3></div>
            <Balls balls={recent} />
          </section>
        ) : null}
      </div>
      <section className="ck-panel">
        <div className="ck-panel-head"><h3>Commentary</h3><button type="button" className="ck-link" onClick={onAll}>All balls</button></div>
        <Commentary items={items.slice(0, 6)} />
      </section>
      <section className="ck-panel">
        <div className="ck-panel-head"><h3>Overs</h3></div>
        <OversList inn={last} ctx={ctx} max={6} />
      </section>
    </div>
  );
}

function ResultCard({ contest }: { contest: ContestView }) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  const top = topPerformers(s, ctx, rules);
  if (!top.bat && !top.bowl) return null;
  return (
    <section className="ck-panel ck-resultcard">
      <div className="ck-panel-head"><h3>Match complete</h3></div>
      <div className="ck-performers">
        {top.bat ? (
          <div><span className="ck-label">Top score</span><b>{top.bat.name}</b><span className="ck-big">{top.bat.line}</span><span className="ck-muted">{ctx.sides?.[top.bat.side].name} · {top.bat.detail}</span></div>
        ) : null}
        {top.bowl ? (
          <div><span className="ck-label">Best bowling</span><b>{top.bowl.name}</b><span className="ck-big">{top.bowl.line}</span><span className="ck-muted">{ctx.sides?.[top.bowl.side].name} · {top.bowl.detail}</span></div>
        ) : null}
      </div>
    </section>
  );
}

function Stats({ intel }: { intel: ContestIntelligence | null }) {
  if (!intel) return <div className="ck-muted">Loading…</div>;
  const charts = intel.analytics.charts.filter((c) => c.series.some((x) => x.values.some((v) => v !== null && v !== 0)));
  return (
    <>
      {charts.map((c) => <ChartView key={c.key} chart={c} />)}
      {intel.teams.map((t) => <StatTableView key={t.key} table={t} />)}
      {intel.analytics.tables.filter((t) => t.key.startsWith("phases")).map((t) => <StatTableView key={t.key} table={t} />)}
      {!charts.length && !intel.teams.length ? <div className="ck-empty">Charts appear after the first over.</div> : null}
    </>
  );
}

function Players({ contest }: { contest: ContestView }) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const sides = contest.context.sides;
  if (!sides) return null;
  return (
    <div className="ck-pad-info">
      {(["a", "b"] as const).map((side) => (
        <section key={side} className="ck-panel">
          <div className="ck-panel-head"><h3>{sides[side].name}</h3><span className="ck-muted">{sides[side].players.length} players</span></div>
          <ul className="ck-squad">
            {sides[side].players.map((p) => {
              const l = playerMatchLine(s, p.id, rules);
              return (
                <li key={p.id}>
                  <span className="ck-squad-no">{p.number ?? ""}</span>
                  <span className="ck-squad-name">{p.name}{p.position ? <small>{p.position}</small> : null}</span>
                  <span className="ck-squad-figs">
                    {l.bat ? <span>{l.bat}</span> : null}
                    {l.bowl ? <span className="ck-muted">{l.bowl}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
