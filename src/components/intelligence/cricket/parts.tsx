"use client";

// Cricket's building blocks for the scorer console and the match centre:
// the score header, the batters and bowler, ball badges, the scorecard,
// commentary and the overs list. All read-only; the pad does the scoring.

import { Fragment, useState } from "react";
import type { MatchContext } from "@/lib/intelligence/core/types";
import { playerName } from "@/lib/intelligence/core/util";
import type { TimelineEntry } from "@/lib/intelligence/types";
import type { CricketInnings, CricketRules, CricketState } from "@/lib/intelligence/sports/cricket";
import {
  ballBadge, battingCard, bowlerLine, bowlingCard, crease, describeDelivery, extrasOf, fallOfWickets, fmt, liveNumbers,
  ordinal, overComplete, overSummaries, parseBallLabel, partnerships, thisOver, type DeliveryPayload,
} from "@/lib/intelligence/sports/cricketView";
import "./cricket.css";

export function Ball({ tag }: { tag: string }) {
  const b = ballBadge(tag);
  return <span className={`ck-ball ${b.tone}`}>{b.text}</span>;
}

export function Balls({ balls, empty = "No balls yet" }: { balls: string[]; empty?: string }) {
  if (!balls.length) return <span className="ck-muted">{empty}</span>;
  return <span className="ck-balls">{balls.map((t, i) => <Ball key={i} tag={t} />)}</span>;
}

/** The batting side's score as the strongest thing on screen, with the chase underneath. */
export function LiveScore({ inn, ctx, rules, compact = false }: { inn: CricketInnings; ctx: MatchContext; rules: CricketRules; compact?: boolean }) {
  const n = liveNumbers(inn, rules);
  return (
    <div className={`ck-live${compact ? " compact" : ""}`}>
      <div className="ck-live-main">
        <div className="ck-live-team">{ctx.sides?.[inn.batting].name}<span>{ordinal(inn.n)} innings</span></div>
        <div className="ck-live-score">{n.runs}<span>/{n.wickets}</span></div>
        <div className="ck-live-overs">{n.overs}{n.maxOvers !== null ? <span> / {n.maxOvers}</span> : null} ov</div>
      </div>
      <div className="ck-live-rates">
        <span><i>CRR</i>{fmt(n.crr)}</span>
        {n.target !== null ? (
          <>
            <span><i>Target</i>{n.target}</span>
            {n.rrr !== null ? <span><i>RRR</i>{fmt(n.rrr)}</span> : null}
          </>
        ) : null}
        {inn.freeHit ? <span className="ck-free">FREE HIT</span> : null}
      </div>
      {n.need !== null && !inn.closed ? (
        <div className="ck-need">
          {n.need === 0 ? "Scores level or passed" : `Need ${n.need} run${n.need === 1 ? "" : "s"}${n.ballsLeft !== null ? ` from ${n.ballsLeft} ball${n.ballsLeft === 1 ? "" : "s"}` : ""}`}
        </div>
      ) : null}
    </div>
  );
}

export function BattersPanel({ inn, ctx, onSwap }: { inn: CricketInnings; ctx: MatchContext; onSwap?: () => void }) {
  const lines = crease(inn, ctx);
  return (
    <section className="ck-panel">
      <div className="ck-panel-head">
        <h3>Batters</h3>
        {onSwap ? <button type="button" className="ck-link" onClick={onSwap}>Swap strike</button> : null}
      </div>
      {lines.length ? (
        <div className="ck-rows">
          <div className="ck-row head"><span>Batter</span><span>R</span><span>B</span><span>4s</span><span>6s</span><span>SR</span></div>
          {lines.map((b) => (
            <div key={b.id} className={`ck-row${b.onStrike ? " strike" : ""}`}>
              <span className="ck-name">{b.onStrike ? <i className="ck-dot" aria-label="On strike" /> : null}{b.name}</span>
              <span className="ck-strong">{b.runs}*</span><span>{b.balls}</span><span>{b.fours}</span><span>{b.sixes}</span><span>{fmt(b.sr)}</span>
            </div>
          ))}
        </div>
      ) : <div className="ck-muted">Waiting for the next batter</div>}
    </section>
  );
}

export function BowlerPanel({ inn, ctx, rules }: { inn: CricketInnings; ctx: MatchContext; rules: CricketRules }) {
  const over = thisOver(inn);
  const done = overComplete(over, rules);
  // between overs: the next bowler once chosen (the scorer's screen), otherwise who bowled the last one
  const id = inn.bowler ?? over?.bowler ?? null;
  const fresh = done && !!inn.bowler;
  const b = id ? bowlerLine(inn, id, ctx, rules) : null;
  return (
    <section className="ck-panel">
      <div className="ck-panel-head"><h3>{done && !inn.bowler ? "Last over" : "Bowling"}</h3></div>
      {id ? (
        <div className="ck-rows">
          <div className="ck-row head"><span>Bowler</span><span>O</span><span>M</span><span>R</span><span>W</span><span>Econ</span></div>
          <div className="ck-row">
            <span className="ck-name">{b?.name ?? playerName(ctx, id)}</span><span>{b?.overs ?? "0.0"}</span><span>{b?.maidens ?? 0}</span><span>{b?.runs ?? 0}</span>
            <span className="ck-strong">{b?.wickets ?? 0}</span><span>{fmt(b?.econ ?? null)}</span>
          </div>
        </div>
      ) : <div className="ck-muted">No bowler yet</div>}
      <div className="ck-thisover">
        <span className="ck-label">{done && !fresh ? `Over ${over!.n}` : "This over"}</span>
        <Balls balls={over && !fresh ? over.balls : []} empty="—" />
        {over && !fresh ? <span className="ck-over-runs">{over.runs} run{over.runs === 1 ? "" : "s"}</span> : null}
      </div>
    </section>
  );
}

export function OversList({ inn, ctx, max }: { inn: CricketInnings; ctx: MatchContext; max?: number }) {
  const all = overSummaries(inn, ctx).reverse();
  const list = max ? all.slice(0, max) : all;
  if (!list.length) return <div className="ck-muted">No overs bowled yet.</div>;
  return (
    <ol className="ck-overs">
      {list.map((o) => (
        <li key={o.n}>
          <span className="ck-over-n">Ov {o.n}</span>
          <span className="ck-over-mid"><Balls balls={o.balls} /><span className="ck-muted">{o.bowler}</span></span>
          <span className="ck-over-tot"><b>{o.runs}</b>{o.wickets ? <em>{o.wickets}W</em> : null}<span className="ck-muted">{o.score}</span></span>
        </li>
      ))}
    </ol>
  );
}

// ── scorecard ───────────────────────────────────────────────────

function InningsCard({ inn, ctx, rules }: { inn: CricketInnings; ctx: MatchContext; rules: CricketRules }) {
  const { lines, yetToBat } = battingCard(inn, ctx);
  const bowl = bowlingCard(inn, ctx, rules);
  const ex = extrasOf(inn);
  const fow = fallOfWickets(inn, ctx, rules);
  const stands = partnerships(inn, ctx);
  const n = liveNumbers(inn, rules);
  const [more, setMore] = useState(false);
  return (
    <div className="ck-grid">
      <section className="ck-panel">
        <div className="ck-panel-head">
          <h3>{ctx.sides?.[inn.batting].name} batting</h3>
          <span className="ck-total">{n.runs}/{n.wickets} <span className="ck-muted">({n.overs} ov)</span></span>
        </div>
        <div className="ck-rows">
          <div className="ck-row head"><span>Batter</span><span>R</span><span>B</span><span>4s</span><span>6s</span><span>SR</span></div>
          {lines.map((b) => (
            <div key={b.id} className={`ck-row${b.atCrease ? " strike" : ""}`}>
              <span className="ck-name">
                <span>{b.name}{b.out ? "" : "*"}</span>
                <small className={b.out ? "" : "notout"}>{b.how}</small>
              </span>
              <span className="ck-strong">{b.runs}</span><span>{b.balls}</span><span>{b.fours}</span><span>{b.sixes}</span><span>{fmt(b.sr)}</span>
            </div>
          ))}
        </div>
        <div className="ck-extras">
          <span>Extras</span>
          <span className="ck-muted">W {ex.wides} · NB {ex.noBalls} · B {ex.byes} · LB {ex.legByes}{ex.penalty ? ` · Pen ${ex.penalty}` : ""}</span>
          <b>{ex.total}</b>
        </div>
        <div className="ck-extras total">
          <span>Total</span>
          <span className="ck-muted">{n.wickets} wkt{n.wickets === 1 ? "" : "s"}, {n.overs} ov{n.crr !== null ? `, RR ${fmt(n.crr)}` : ""}</span>
          <b>{n.runs}</b>
        </div>
        {yetToBat.length ? (
          <div className="ck-dnb"><span className="ck-label">{inn.closed ? "Did not bat" : "Yet to bat"}</span> {yetToBat.map((p) => p.name).join(", ")}</div>
        ) : null}
      </section>

      {fow.length ? (
        <section className="ck-panel">
          <div className="ck-panel-head"><h3>Fall of wickets</h3></div>
          <div className="ck-fow">
            {fow.map((f) => <span key={f.wicket}><b>{f.score}</b> <span className="ck-muted">{f.name}, {f.over} ov</span></span>)}
          </div>
        </section>
      ) : null}

      {bowl.length ? (
        <section className="ck-panel">
          <div className="ck-panel-head">
            <h3>{ctx.sides?.[inn.batting === "a" ? "b" : "a"].name} bowling</h3>
            <button type="button" className="ck-link" onClick={() => setMore((v) => !v)}>{more ? "Fewer columns" : "Wides, no balls, dots"}</button>
          </div>
          <div className={`ck-rows${more ? " wide" : ""}`}>
            <div className="ck-row head"><span>Bowler</span><span>O</span><span>M</span><span>R</span><span>W</span><span>Econ</span>{more ? <><span>Wd</span><span>Nb</span><span>Dots</span></> : null}</div>
            {bowl.map((b) => (
              <div key={b.id} className={`ck-row${inn.bowler === b.id ? " strike" : ""}`}>
                <span className="ck-name">{b.name}</span><span>{b.overs}</span><span>{b.maidens}</span><span>{b.runs}</span><span className="ck-strong">{b.wickets}</span><span>{fmt(b.econ)}</span>
                {more ? <><span>{b.wides}</span><span>{b.noBalls}</span><span>{b.dots}</span></> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {stands.length ? (
        <section className="ck-panel">
          <div className="ck-panel-head"><h3>Partnerships</h3></div>
          <div className="ck-stands">
            {stands.slice().reverse().map((st) => (
              <div key={st.wicket} className={`ck-stand${st.current ? " current" : ""}`}>
                <span className="ck-label">{st.current ? "Current" : `${ordinal(st.wicket)} wkt`}</span>
                <span className="ck-stand-who">{st.batters.map((b) => `${b.name}${b.runs !== null ? ` ${b.runs}*` : ""}`).join(" & ")}</span>
                <span className="ck-stand-n"><b>{st.runs}</b> <span className="ck-muted">({st.balls})</span></span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function Scorecard({ state, ctx, rules }: { state: CricketState; ctx: MatchContext; rules: CricketRules }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!state.innings.length) return <div className="ck-empty">The scorecard starts with the first ball.</div>;
  const idx = pick ?? state.innings.length - 1;
  const inn = state.innings[idx];
  return (
    <div className="ck-grid">
      {state.innings.length > 1 ? (
        <div className="ck-seg" role="tablist">
          {state.innings.map((i, k) => (
            <button key={i.n} type="button" role="tab" aria-selected={k === idx} className={k === idx ? "on" : ""} onClick={() => setPick(k)}>
              {ctx.sides?.[i.batting].name}{rules.inningsPerSide > 1 ? ` · ${ordinal(Math.ceil(i.n / 2))}` : ""}
              <b>{i.runs}/{i.wickets}</b>
            </button>
          ))}
        </div>
      ) : null}
      <InningsCard key={inn.n} inn={inn} ctx={ctx} rules={rules} />
    </div>
  );
}

// ── commentary ──────────────────────────────────────────────────

export interface CommentaryItem {
  entry: TimelineEntry;
  innings: number;
  ball: string;
  badge: string;
  tone: string;
  headline: string;
  text: string;
  /** "End of over 7: Team A 82/4" and the like, from the rules */
  after: string[];
}

/** Deliveries newest first, in match order: a corrected ball sits where the ball it replaced was. */
export function commentaryFrom(entries: TimelineEntry[], ctx: MatchContext): CommentaryItem[] {
  const items: (CommentaryItem & { at: number })[] = [];
  for (const e of entries) {
    if (e.type !== "DELIVERY" || e.superseded) continue;
    const at = parseBallLabel(e.label);
    if (!at) continue;
    const d = describeDelivery(e.payload as DeliveryPayload, ctx);
    items.push({ entry: e, innings: at.innings, ball: at.ball, ...d, after: e.derived, at: e.correction?.kind === "replace" && e.correction.targetSeq ? e.correction.targetSeq : e.seq });
  }
  return items.sort((x, y) => y.at - x.at);
}

export function Commentary({ items, onEdit, onRemove, compact = false }: {
  items: CommentaryItem[]; onEdit?: (e: TimelineEntry) => void; onRemove?: (e: TimelineEntry) => void; compact?: boolean;
}) {
  if (!items.length) return <div className="ck-empty">Ball-by-ball commentary appears here once play starts.</div>;
  return (
    <ol className={`ck-comm${compact ? " compact" : ""}`}>
      {items.map((c, i) => {
        const prev = items[i - 1];
        return (
          <Fragment key={c.entry.id}>
            {prev && prev.innings !== c.innings ? <li className="ck-comm-break">{ordinal(c.innings)} innings</li> : null}
            {c.after.filter((t) => !t.startsWith("End of over")).map((t, k) => <li key={`a${k}`} className="ck-comm-event">{t}</li>)}
            {c.after.some((t) => t.startsWith("End of over")) ? (
              <li className="ck-comm-over">{c.after.find((t) => t.startsWith("End of over"))}</li>
            ) : null}
            <li className={`ck-comm-ball ${c.tone}`}>
              <span className="ck-comm-at">{c.ball}</span>
              <span className={`ck-ball ${c.tone}`}>{c.badge}</span>
              <div className="ck-comm-body">
                <b>{c.headline}</b>
                <p>{c.text}</p>
                {c.entry.correction?.kind === "replace" ? <small className="ck-muted">Corrected by the scorer</small> : null}
              </div>
              {onEdit || onRemove ? (
                <span className="ck-comm-tools">
                  {onEdit ? <button type="button" className="ck-link" onClick={() => onEdit(c.entry)}>Edit</button> : null}
                  {onRemove ? <button type="button" className="ck-link danger" onClick={() => onRemove(c.entry)}>Remove</button> : null}
                </span>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
