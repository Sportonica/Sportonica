"use client";

// The cricket scorer console's header and side column: the live score
// pinned on top, and beside the pad the overs so far and the commentary,
// where any ball can be edited or removed.

import { useMemo, useState } from "react";
import type { ContestView, TimelineEntry } from "@/lib/intelligence/types";
import type { CricketRules, CricketState } from "@/lib/intelligence/sports/cricket";
import { latestInnings, sideScores } from "@/lib/intelligence/sports/cricketView";
import { StatusPill } from "../views";
import { Commentary, LiveScore, OversList, commentaryFrom } from "./parts";
import { EditDeliverySheet } from "./sheets";

export function CricketScorerHeader({ contest }: { contest: ContestView }) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  const inn = latestInnings(s);
  const others = sideScores(s, ctx, rules).filter((x) => !inn || x.side !== inn.batting);
  return (
    <div className="ck-head">
      <div className="ck-head-top">
        <span className="ck-sport">Cricket</span>
        <StatusPill status={contest.status} />
        {others.map((o) => (
          <span key={o.side} className="ck-head-other">{o.name} <b>{o.score ?? "yet to bat"}</b>{o.score && o.overs ? <span className="ck-muted"> ({o.overs})</span> : null}</span>
        ))}
      </div>
      {inn ? <LiveScore inn={inn} ctx={ctx} rules={rules} compact /> : <div className="ck-muted">{ctx.sides?.a.name} v {ctx.sides?.b.name}: no ball bowled yet</div>}
      {contest.summary.resultText ? <div className="ck-result-line">{contest.summary.resultText}</div> : null}
    </div>
  );
}

export function CricketScorerSide({ contest, entries, busy, onEdit, onRemove, children }: {
  contest: ContestView; entries: TimelineEntry[]; busy: boolean;
  onEdit: (e: TimelineEntry, payload: Record<string, unknown>, reason: string) => void;
  onRemove: (e: TimelineEntry) => void;
  children?: React.ReactNode;
}) {
  const s = contest.state as CricketState;
  const ctx = contest.context;
  const inn = latestInnings(s);
  const [view, setView] = useState<"balls" | "overs">("balls");
  const [editing, setEditing] = useState<TimelineEntry | null>(null);
  const items = useMemo(() => commentaryFrom(entries, ctx), [entries, ctx]);
  const editable = contest.status === "live" || contest.status === "paused";
  return (
    <div className="si-card ck-side">
      <div className="ck-seg small" role="tablist">
        <button type="button" role="tab" aria-selected={view === "balls"} className={view === "balls" ? "on" : ""} onClick={() => setView("balls")}>Ball by ball</button>
        <button type="button" role="tab" aria-selected={view === "overs"} className={view === "overs" ? "on" : ""} onClick={() => setView("overs")}>Overs</button>
      </div>
      {view === "balls" ? (
        <>
          {editable ? <div className="ck-muted" style={{ fontSize: 12.5 }}>Tap Edit on any ball to change it. The innings is worked out again from that ball on.</div> : null}
          <Commentary items={items} compact onEdit={editable && !busy ? setEditing : undefined} onRemove={editable && !busy ? onRemove : undefined} />
        </>
      ) : inn ? <OversList inn={inn} ctx={ctx} /> : <div className="ck-muted">No overs bowled yet.</div>}
      {children}
      {editing ? (
        <EditDeliverySheet entry={editing} ctx={ctx} onClose={() => setEditing(null)}
          onSave={(payload, reason) => { onEdit(editing, payload, reason); setEditing(null); }} />
      ) : null}
    </div>
  );
}
