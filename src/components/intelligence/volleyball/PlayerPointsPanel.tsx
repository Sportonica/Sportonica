"use client";

// The scorer adds points to a player by hand: a number and a button, no
// category. These are the player's record. They go through the same event log
// as everything else (so who, when, undo and corrections come with it) and
// nothing here can reach the team's score.

import { useCallback, useEffect, useState } from "react";
import { getPlayerPoints, type PlayerPointsEntry, type PlayerPointsView } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import type { Participant, Side } from "@/lib/intelligence/core/types";
import type { VolleyballState } from "@/lib/intelligence/sports/volleyball";
import type { ContestView } from "@/lib/intelligence/types";
import { shortName } from "./parts";

const SIDES: Side[] = ["a", "b"];
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kathmandu" });

export default function PlayerPointsPanel({ contest, waiting, busy, send, correct }: {
  contest: ContestView;
  /** taps still on their way to the server */
  waiting: number;
  busy: boolean;
  send: (type: string, payload: Record<string, unknown>) => void;
  correct: (target: { id: string }, reason: string, replacement?: { type: string; payload: Record<string, unknown> }) => Promise<void>;
}) {
  const s = contest.state as VolleyballState | null;
  const [view, setView] = useState<PlayerPointsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getPlayerPoints(contest.id);
      if (isActionError(res)) { setLoadError(res.message); return null; }
      setLoadError(null);
      setView(res);
      return res;
    } catch {
      setLoadError("No connection. The history could not be loaded.");
      return null;
    }
  }, [contest.id]);

  // once the scorer pauses, as with the timeline: server actions from a tab run one at a time
  useEffect(() => {
    if (waiting) return;
    const t = setTimeout(() => { void load(); }, 700);
    return () => clearTimeout(t);
  }, [load, contest.lastSeq, waiting]);

  if (!s || !contest.context.sides) return null;
  const sides = contest.context.sides;
  const everyone = [...sides.a.players, ...sides.b.players];
  const nameOf = (id: string) => shortName(everyone.find((p) => p.id === id));
  const open = contest.status === "live" || contest.status === "paused" || contest.status === "completed" || contest.status === "abandoned";
  const walkover = contest.summary.result?.method === "walkover";
  const canAdd = open && !walkover;
  const entries = view?.entries ?? [];
  const latest = entries.find((e) => e.state === "active");

  const undoLast = async () => {
    // never from the list on screen: it may be a tap behind
    const fresh = await load();
    const last = fresh?.entries.find((e) => e.state === "active");
    if (last) await correct(last, "Undone by the scorer");
  };

  return (
    <section className="si-card" id="player-points" style={{ scrollMarginTop: 90 }}>
      <div className="vb-pts-head">
        <div>
          <h2 className="si-h2" style={{ margin: 0 }}>Player points</h2>
          <p className="vb-pts-note">For each player&apos;s record only. These never change the team score.</p>
        </div>
        {canAdd ? (
          <button type="button" className="si-btn small" disabled={busy || waiting > 0 || !latest} onClick={() => void undoLast()}>
            {latest ? `Undo +${latest.points} ${nameOf(latest.player)}` : "Undo last"}
          </button>
        ) : null}
      </div>

      {walkover ? <div className="si-info">This match was a walkover, so nobody played and no points can be added.</div>
        : contest.status === "cancelled" ? <div className="si-info">This match was called off, so no points can be added.</div>
        : !open ? <div className="si-info">Start the match, or enter its result, to add player points.</div>
        : (
          <div className="vb-pts-teams">
            {SIDES.map((side) => (
              <div key={side}>
                <div className="vb-court-t">{sides[side].name}</div>
                <div className="vb-pts-list">
                  {[...sides[side].players].sort((x, y) => (x.number ?? 9999) - (y.number ?? 9999)).map((p) => (
                    <PlayerRow key={p.id} player={p} photo={view?.photos[p.id] ?? null} total={s.players[p.id]?.manualPoints ?? 0}
                      onAdd={(points) => send("PLAYER_POINTS", { player: p.id, points })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      {loadError ? <div className="si-error" role="alert" style={{ marginTop: 12 }}>{loadError}</div> : null}

      {entries.length ? (
        <details className="si-more vb-pts-history">
          <summary>Adjustment history ({entries.length})</summary>
          {entries.map((e) => (
            <Entry key={e.id} entry={e} name={nameOf(e.player)} busy={busy || waiting > 0} fixing={fixing === e.id}
              onFix={() => setFixing(fixing === e.id ? null : e.id)}
              onUndo={() => void correct(e, "Undone by the scorer")}
              onSave={(points, reason) => { setFixing(null); void correct(e, reason, { type: "PLAYER_POINTS", payload: { player: e.player, points } }); }} />
          ))}
        </details>
      ) : null}
    </section>
  );
}

function PlayerRow({ player, photo, total, onAdd }: { player: Participant; photo: string | null; total: number; onAdd: (points: number) => void }) {
  const [value, setValue] = useState("");
  const points = Number(value);
  return (
    <div className="vb-pts-row">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="vb-pts-photo" src={photo} alt="" />
      ) : <span className="vb-pts-photo" aria-hidden="true">{player.number ?? player.name.charAt(0).toUpperCase()}</span>}
      <div className="vb-pts-who">{shortName(player)}</div>
      <div className="vb-pts-total" aria-live="polite"><b>{total}</b><small>points</small></div>
      <form className="vb-pts-add" onSubmit={(e) => {
        e.preventDefault();
        if (points < 1) return;
        // cleared at once, so a second tap has nothing to send
        setValue("");
        onAdd(points);
      }}>
        <input className="vb-pts-input" inputMode="numeric" placeholder="0" value={value} aria-label={`Points to add to ${player.name}`} onChange={(e) => setValue(digits(e.target.value))} />
        <button type="submit" className="si-btn primary small" disabled={points < 1}>Add Points</button>
        <button type="button" className="si-btn small" aria-label={`Add 1 point to ${player.name}`} onClick={() => onAdd(1)}>+1</button>
      </form>
    </div>
  );
}

function Entry({ entry: e, name, busy, fixing, onFix, onUndo, onSave }: {
  entry: PlayerPointsEntry; name: string; busy: boolean; fixing: boolean;
  onFix: () => void; onUndo: () => void; onSave: (points: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState(String(e.points));
  const [reason, setReason] = useState("");
  const active = e.state === "active";
  const points = Number(amount);
  return (
    <div className={`vb-pts-entry${active ? "" : " off"}`}>
      <div>
        <b>+{e.points}</b> {name}
        {e.corrects !== null ? <span> (was +{e.corrects})</span> : null}
        <small>{[e.by ?? "A scorer", when(e.at)].join(", ")}</small>
        {e.state === "undone" ? <small>Undone{e.reason ? `: ${e.reason}` : ""}</small> : null}
        {e.state === "replaced" ? <small>Corrected later</small> : null}
        {active && e.reason ? <small>Reason: {e.reason}</small> : null}
      </div>
      {active ? (
        <div className="si-row" style={{ gap: 6 }}>
          <button type="button" className="si-btn small" disabled={busy} onClick={onFix}>{fixing ? "Close" : "Correct"}</button>
          <button type="button" className="si-btn small" disabled={busy} onClick={onUndo}>Undo</button>
        </div>
      ) : null}
      {active && fixing ? (
        <form className="vb-pts-fix" onSubmit={(ev) => { ev.preventDefault(); if (points >= 1 && points !== e.points && reason.trim()) onSave(points, reason.trim()); }}>
          <input className="vb-pts-input" inputMode="numeric" value={amount} aria-label="Correct number of points" onChange={(ev) => setAmount(digits(ev.target.value))} />
          <input className="vb-pts-reason" type="text" placeholder="Why is it changing?" maxLength={200} value={reason} aria-label="Reason for the correction" onChange={(ev) => setReason(ev.target.value)} />
          <button type="submit" className="si-btn primary small" disabled={busy || points < 1 || points === e.points || !reason.trim()}>Save correction</button>
        </form>
      ) : null}
    </div>
  );
}
