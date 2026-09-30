"use client";

// Generic read-only views. They render whatever an engine returned
// (ScoreView, StatTable, Chart) and never branch on the sport.

import { useMemo, useRef, useState } from "react";
import type { ContestSummary } from "@/lib/intelligence/core/engine";
import type { AnalyticsCard, Chart, ContestStatus, MatchContext, StatTable } from "@/lib/intelligence/core/types";
import { formatStat } from "@/lib/intelligence/core/util";
import type { TimelineEntry } from "@/lib/intelligence/types";

export const STATUS_LABEL: Record<ContestStatus, string> = {
  scheduled: "Upcoming", live: "Live", paused: "Paused", completed: "Completed",
  abandoned: "Abandoned", postponed: "Postponed", cancelled: "Cancelled",
};

export function StatusPill({ status }: { status: ContestStatus }) {
  return <span className={`si-pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

const SERIES = ["--si-series-1", "--si-series-2", "--si-series-3", "--si-series-4", "--si-series-5", "--si-series-6", "--si-series-7", "--si-series-8"];
// Colour follows the entity: side A is always slot 1 and side B slot 2.
const seriesColor = (side: "a" | "b" | null, index: number): string =>
  `var(${side === "a" ? SERIES[0] : side === "b" ? SERIES[1] : SERIES[index % SERIES.length]})`;

export function ScoreCard({ summary, context }: { summary: ContestSummary; context: MatchContext }) {
  const v = summary.view;
  return (
    <div className="si-card si-score" aria-live="polite">
      <div className="si-score-top">
        <StatusPill status={summary.status} />
        <span className="si-score-period">{v.periodLabel}</span>
      </div>

      {v.kind === "versus" && v.score && context.sides ? (
        <div className="si-versus">
          {(["a", "b"] as const).map((side, i) => (
            <div key={side} className={`si-team ${side}`} style={{ gridColumn: i === 0 ? 1 : 3, gridRow: 1 }}>
              <span className="si-team-name">
                {v.serving === side && <span className="si-serve" title="Serving" aria-label="Serving" />}
                {context.sides![side].name}
              </span>
              <span className="si-team-score">{v.score![side]}</span>
              {v.subScore?.[side] ? <span className="si-team-sub">{v.subScore[side]}</span> : null}
            </div>
          ))}
          <span className="si-vs" style={{ gridColumn: 2, gridRow: 1 }}>v</span>
        </div>
      ) : null}

      {v.kind === "race" && v.lanes ? (
        <div className="si-table-wrap">
          <table className="si-table si-lanes">
            <thead><tr><th>Swimmer</th><th>Lane</th><th>Place</th><th>Time</th><th className="text">Status</th></tr></thead>
            <tbody>
              {v.lanes.map((l) => (
                <tr key={l.lane}>
                  <td>{l.name}</td>
                  <td>{l.lane}</td>
                  <td className="rank">{l.rank ?? <span className="na">n/a</span>}</td>
                  <td>{l.time ?? <span className="na">n/a</span>}</td>
                  <td className="text">{l.status}{l.detail ? <span className="si-muted"> · {l.detail}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {summary.resultText ? <div className="si-result">{summary.resultText}</div> : null}
      {summary.statusReason ? <div className="si-reason">{summary.statusReason}</div> : null}
      {v.notes.length ? <div className="si-notes">{v.notes.map((n, i) => <span key={i}>{n}</span>)}</div> : null}

      {v.periods && v.periods.length > 1 && context.sides ? (
        <div className="si-table-wrap">
          <table className="si-table">
            <thead><tr><th>&nbsp;</th>{v.periods.map((p) => <th key={p.label}>{p.label}</th>)}</tr></thead>
            <tbody>
              {(["a", "b"] as const).map((side) => (
                <tr key={side}><td>{context.sides![side].name}</td>{v.periods!.map((p) => <td key={p.label}>{p[side] || <span className="na">·</span>}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function StatCards({ cards }: { cards: AnalyticsCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="si-cards">
      {cards.map((c) => (
        <div key={c.label} className="si-stat">
          <div className="si-stat-label">{c.label}</div>
          <div className="si-stat-value">{c.value}</div>
          {c.hint ? <div className="si-stat-hint">{c.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function StatTableView({ table, max }: { table: StatTable; max?: number }) {
  const cols = max ? table.columns.slice(0, max) : table.columns;
  if (!table.rows.length) return null;
  const hasDerived = cols.some((c) => c.kind === "derived");
  return (
    <div className="si-card">
      <h3 className="si-h2">{table.title}</h3>
      <div className="si-table-wrap">
        <table className="si-table">
          <thead>
            <tr><th>&nbsp;</th>{cols.map((c) => <th key={c.key} className={`${c.kind === "derived" ? "derived" : ""} ${c.format === "text" ? "text" : ""}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.side ? <span className="si-key" style={{ background: seriesColor(r.side, 0) }} /> : null}{r.name}</td>
                {cols.map((c) => {
                  const v = r.values[c.key];
                  return <td key={c.key} className={c.format === "text" ? "text" : ""}>{v === null || v === undefined ? <span className="na">n/a</span> : formatStat(v, c.format)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasDerived ? <div className="si-legend-note">Columns in italics are calculated from the recorded events. &quot;n/a&quot; means there is not enough data to calculate it.</div> : null}
    </div>
  );
}

// ── charts ──────────────────────────────────────────────────────

const W = 640, H = 240, PAD = { l: 44, r: 12, t: 10, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  // the first round number that fits, so 21 points gets a 0-25 axis, not 0-50
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => n <= step) ?? 10) * pow;
}

export function ChartView({ chart }: { chart: Chart }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fmt = (v: number | null) => (v === null ? "n/a" : formatStat(v, chart.format === "int" ? "int" : chart.format));

  const { max, min } = useMemo(() => {
    const all = chart.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    if (!all.length) return { max: 1, min: 0 };
    // times are compared, not read from zero: a 52 s race drawn from 0 hides every difference
    const lo = chart.format === "time" && chart.type === "line" ? Math.min(...all) * 0.98 : 0;
    return { max: chart.format === "time" ? Math.max(...all) * 1.02 : niceMax(Math.max(...all)), min: lo };
  }, [chart]);

  const n = chart.labels.length;
  if (!n || !chart.series.length) return null;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (chart.type === "bar" ? (i + 0.5) * (iw / n) : n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => PAD.t + ih - ((v - min) / (max - min || 1)) * ih;
  // whole-number data gets whole-number gridlines (no "2.5 points")
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min)).map((t) => (chart.format === "int" ? Math.round(t) : t)))];
  const labelEvery = Math.max(1, Math.ceil(n / 10));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W - PAD.l;
    const i = chart.type === "bar" ? Math.floor(px / (iw / n)) : Math.round((px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const groupW = (iw / n) * 0.72;
  const barW = Math.max(3, Math.min(28, (groupW - 2 * (chart.series.length - 1)) / chart.series.length));

  return (
    <div className="si-card">
      <div className="si-chart-head">
        <span className="si-chart-title">{chart.title}</span>
        <button type="button" className="si-link-btn" onClick={() => setAsTable((v) => !v)}>{asTable ? "Show chart" : "Show as table"}</button>
      </div>

      {asTable ? (
        <div className="si-table-wrap">
          <table className="si-table">
            <thead><tr><th>&nbsp;</th>{chart.series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
            <tbody>{chart.labels.map((l, i) => <tr key={i}><td>{l}</td>{chart.series.map((s) => <td key={s.name}>{fmt(s.values[i] ?? null)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="si-chart" ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove}>
            {ticks.map((t, i) => (
              <g key={i}>
                <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{chart.format === "time" ? formatStat(Math.round(t), "time") : Math.round(t * 10) / 10}</text>
              </g>
            ))}
            {chart.labels.map((l, i) => (i % labelEvery === 0 ? <text key={i} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{l.length > 10 ? `${l.slice(0, 9)}…` : l}</text> : null))}

            {chart.type === "line" && hover !== null ? <line className="hairline" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} /> : null}

            {chart.series.map((s, si) => {
              const color = seriesColor(s.side, si);
              if (chart.type === "bar") {
                return s.values.map((v, i) => {
                  if (v === null) return null;
                  const left = x(i) - groupW / 2 + si * (barW + 2) + (groupW - chart.series.length * (barW + 2) + 2) / 2;
                  const top = y(v), h = Math.max(0, PAD.t + ih - top);
                  const r = Math.min(4, barW / 2, h);
                  return <path key={`${si}-${i}`} fill={color} opacity={hover === null || hover === i ? 1 : 0.45}
                    d={`M${left},${top + h} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${top + h} Z`} />;
                });
              }
              // a gap in the data breaks the line rather than being drawn through
              const segs: string[] = [];
              let open = false;
              s.values.forEach((v, i) => {
                if (v === null) { open = false; return; }
                segs.push(`${open ? "L" : "M"}${x(i)},${y(v)}`);
                open = true;
              });
              const hv = hover !== null ? s.values[hover] : null;
              return (
                <g key={si}>
                  <path d={segs.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {hv !== null && hv !== undefined && hover !== null ? <circle cx={x(hover)} cy={y(hv)} r={4.5} fill={color} stroke="var(--si-solid)" strokeWidth={2} /> : null}
                </g>
              );
            })}
          </svg>
          {hover !== null ? (
            <div className="si-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 0 }}>
              <b>{chart.labels[hover]}</b>
              {chart.series.map((s, si) => <div key={s.name}><i style={{ background: seriesColor(s.side, si) }} />{s.name}: {fmt(s.values[hover] ?? null)}</div>)}
            </div>
          ) : null}
          {chart.series.length > 1 ? (
            <div className="si-legend">{chart.series.map((s, si) => <span key={s.name}><i style={{ background: seriesColor(s.side, si) }} />{s.name}</span>)}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── timeline ────────────────────────────────────────────────────

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Timeline({ entries, onCorrect }: { entries: TimelineEntry[]; onCorrect?: (e: TimelineEntry) => void }) {
  if (!entries.length) return <div className="si-info">No events yet.</div>;
  return (
    <ol className="si-timeline">
      {entries.map((e) => (
        <li key={e.id} className={`si-tl${e.superseded ? " dead" : ""}`}>
          <span className="si-tl-seq">#{e.seq}</span>
          <div>
            <div className="si-tl-text">{e.label ? `${e.label}: ` : ""}{e.text}</div>
            {e.derived.map((d, i) => <div key={i} className="si-tl-derived">{d}</div>)}
            {e.correction ? (
              <div className="si-tl-fix">
                {e.correction.kind === "void" ? "Reverses" : "Replaces"} event #{e.correction.targetSeq ?? "?"}. Reason: {e.correction.reason}
              </div>
            ) : null}
            {e.superseded ? <div className="si-tl-fix">Corrected by a later event</div> : null}
            <div className="si-tl-meta">{timeOf(e.occurredAt)}{e.recordedBy ? ` · ${e.recordedBy}` : ""}</div>
          </div>
          {onCorrect && !e.superseded && e.type !== "CORRECTION_VOID" && !e.correction?.kind.startsWith("void") ? (
            <button type="button" className="si-btn small" onClick={() => onCorrect(e)}>Correct</button>
          ) : <span />}
        </li>
      ))}
    </ol>
  );
}
