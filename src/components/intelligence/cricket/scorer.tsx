"use client";

// The cricket scorer console's header and side column: the live score
// pinned on top, and beside the pad the overs so far and the commentary,
// where any ball can be edited or removed (after the match too). And the
// organiser's way to end a match the score has not decided yet.

import { useMemo, useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
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
      {inn ? <LiveScore inn={inn} ctx={ctx} rules={rules} compact /> : (
        <div className="ck-muted">
          {ctx.sides?.a.name} v {ctx.sides?.b.name}: no ball bowled yet
          {rules.oversPerInnings !== null ? ` · ${s.oversLimit ?? rules.oversPerInnings} overs an innings` : ""}
        </div>
      )}
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
  // a finished match too: a corrected ball re-works the result and sends it to the fixture
  const editable = contest.status === "live" || contest.status === "paused" || contest.status === "completed";
  return (
    <div className="si-card ck-side">
      <div className="ck-seg small" role="tablist">
        <button type="button" role="tab" aria-selected={view === "balls"} className={view === "balls" ? "on" : ""} onClick={() => setView("balls")}>Ball by ball</button>
        <button type="button" role="tab" aria-selected={view === "overs"} className={view === "overs" ? "on" : ""} onClick={() => setView("overs")}>Overs</button>
      </div>
      {view === "balls" ? (
        <>
          {editable ? (
            <div className="ck-muted" style={{ fontSize: 12.5 }}>
              Tap Edit on any ball to change it. The innings is worked out again from that ball on
              {contest.status === "completed" ? ", and the result and everyone's figures are updated" : ""}.
            </div>
          ) : null}
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

/**
 * End the match before the score decides it (rain, bad light, time up):
 * the organiser names the winner or a tie, with a reason kept in the
 * record. The scorecard stays as it was when play stopped.
 */
export function EndMatchEarly({ contest, onEnd }: {
  contest: ContestView;
  onEnd: (result: { outcome: "win" | "tie"; winner?: Side; margin?: string }, reason: string) => void;
}) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Side | "tie" | null>(null);
  const [margin, setMargin] = useState("");
  const [reason, setReason] = useState("");
  if (!ctx.sides) return null;
  if (!open) return <button type="button" className="si-btn" onClick={() => setOpen(true)}>End match now</button>;
  const name = (side: Side) => ctx.sides![side].name;
  const ready = pick !== null && reason.trim().length > 0;
  const end = () => {
    if (!ready) return;
    const what = pick === "tie" ? "a tie" : `${name(pick)} winning`;
    if (!window.confirm(`End the match now with ${what}? The result becomes final and goes to the fixture.`)) return;
    onEnd(pick === "tie" ? { outcome: "tie", ...(margin.trim() ? { margin: margin.trim() } : {}) } : { outcome: "win", winner: pick, ...(margin.trim() ? { margin: margin.trim() } : {}) }, reason.trim());
    setOpen(false);
  };
  return (
    <div className="si-ask" style={{ display: "grid", width: "100%" }}>
      <div className="si-pad-name">End the match now</div>
      <div className="ck-muted" style={{ fontSize: 12.5 }}>
        {sideScores(s, ctx, rules).map((x) => `${x.name} ${x.score ?? "yet to bat"}${x.score && x.overs ? ` (${x.overs} ov)` : ""}`).join(" · ")}
        . The scorecard stays as it is; you decide the result.
      </div>
      <div className="si-keys two">
        {(["a", "b"] as const).map((side) => (
          <button type="button" key={side} className={`si-key-btn${pick === side ? " on" : ""}`} onClick={() => setPick(side)}>{name(side)} won</button>
        ))}
        <button type="button" className={`si-key-btn${pick === "tie" ? " on" : ""}`} onClick={() => setPick("tie")}>Tie</button>
      </div>
      <label className="si-label">How it was decided (optional)
        <input className="si-input" value={margin} onChange={(e) => setMargin(e.target.value)} maxLength={80} placeholder="on run rate" />
      </label>
      <label className="si-label">Why is it ending now? (kept in the record)
        <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rain, no more play possible" />
      </label>
      <div className="si-row">
        <button type="button" className="si-btn primary" disabled={!ready} onClick={end}>End match with this result</button>
        <button type="button" className="ck-link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <div className="ck-muted" style={{ fontSize: 12 }}>For no result, use Abandon under &quot;Postpone, cancel, abandon&quot; instead.</div>
    </div>
  );
}
