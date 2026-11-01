"use client";

// What the scorer and the public match page both show for volleyball:
// the court, the set scorecard and the match clock. They only read the
// engine's state; nothing here works out a rule.

import { useEffect, useState } from "react";
import type { MatchContext, Participant, Side } from "@/lib/intelligence/core/types";
import type { VolleyballState } from "@/lib/intelligence/sports/volleyball";
import { COURT_POSITIONS } from "@/lib/intelligence/sports/volleyballRules";
import "./volleyball.css";

export const playerOf = (context: MatchContext, side: Side, id: string): Participant | undefined =>
  context.sides?.[side].players.find((p) => p.id === id);

export const shortName = (p: Participant | undefined, fallback = "Player"): string =>
  p ? `${p.number != null ? `#${p.number} ` : ""}${p.name}` : fallback;

// How the six positions sit on court, seen from behind the back line: indexes into the rotation order
const COURT_GRID = [3, 2, 1, 4, 5, 0] as const;

export function Court({ state, context, side }: { state: VolleyballState; context: MatchContext; side: Side }) {
  const order = state.rotation[side];
  const name = context.sides?.[side].name ?? "";
  const serving = state.serving === side && !state.decided;
  if (!order) return <div className="vb-court-none">{name}: starting order not set</div>;
  const libero = state.liberoOn[side]?.libero;

  if (order.length !== 6) {
    return (
      <div className="vb-pairs" aria-label={`${name} on court`}>
        <div className="vb-court-t">{name}</div>
        {order.map((id, i) => (
          <div key={id} className={`vb-pair${serving && i === 0 ? " serve" : ""}`}>
            <span>{shortName(playerOf(context, side, id))}</span>
            {serving && i === 0 ? <b>Serving</b> : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <div className="vb-court-t">{name}</div>
      <div className={`vb-court side-${side}`} role="img"
        aria-label={`${name} on court: ${order.map((id, i) => `${COURT_POSITIONS[i]} ${shortName(playerOf(context, side, id))}`).join(", ")}`}>
        <div className="vb-net">Net</div>
        {COURT_GRID.map((at) => {
          const id = order[at], p = playerOf(context, side, id);
          const isServer = serving && at === 0;
          return (
            <div key={at} className={`vb-spot${isServer ? " serve" : ""}${id === libero ? " libero" : ""}`} title={COURT_POSITIONS[at]}>
              <b>{p?.number ?? "–"}</b>
              <span>{p?.name.split(" ")[0] ?? "Player"}</span>
              <small>{isServer ? "Serving" : id === libero ? "Libero" : `P${at + 1}`}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SetScorecard({ state, context }: { state: VolleyballState; context: MatchContext }) {
  const a = context.sides?.a.name ?? "", b = context.sides?.b.name ?? "";
  const sets = state.sets.filter((g, i) => g.a + g.b > 0 || i === state.sets.length - 1);
  const w = state.decided;
  return (
    <div className="si-card">
      <h2 className="si-h2">Set scorecard</h2>
      <div className="si-table-wrap">
        <table className="si-table vb-sets">
          <thead><tr><th className="text">Team</th>{sets.map((_, i) => <th key={i}>Set {i + 1}</th>)}<th>Sets</th></tr></thead>
          <tbody>
            {(["a", "b"] as Side[]).map((side) => (
              <tr key={side} className={w === side ? "won" : undefined}>
                <td className="text">{side === "a" ? a : b}</td>
                {sets.map((g, i) => <td key={i} className={g.winner === side ? "won" : undefined}>{g[side]}</td>)}
                <td className="total">{state.setsWon[side]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {w ? <div className="vb-final">{w === "a" ? a : b} won {state.setsWon[w]}–{state.setsWon[w === "a" ? "b" : "a"]}</div> : null}
    </div>
  );
}

const clock = (ms: number): string => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};

/** Time since the match started: ticking while it runs, fixed once it ends. */
export function MatchClock({ startedAt, completedAt }: { startedAt: string | null; completedAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    if (completedAt) return () => clearTimeout(first);
    const t = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [completedAt]);
  if (!startedAt) return null;
  const end = completedAt ? Date.parse(completedAt) : now;
  if (end === null) return null;
  return <span>{clock(Math.max(end - Date.parse(startedAt), 0))}</span>;
}
